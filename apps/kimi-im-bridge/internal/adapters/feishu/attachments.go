package feishu

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
)

func (s *Service) cacheInboundAttachments(ctx context.Context, inbound domain.InboundMessage) error {
	if len(inbound.Attachments) == 0 {
		return nil
	}
	baseDir := strings.TrimSpace(s.config.AttachmentsDir)
	if baseDir == "" {
		return reliability.Wrap("unknown", fmt.Errorf("feishu attachmentsDir is not configured"))
	}
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return reliability.Wrap("unknown", fmt.Errorf("create feishu attachments dir: %w", err))
	}

	now := time.Now().UTC()
	for _, attachment := range inbound.Attachments {
		resource, err := s.downloadInboundAttachment(ctx, attachment)
		if err != nil {
			return err
		}
		stagedPath, err := stageDownloadedResource(baseDir, inbound.ChatID, inbound.ThreadID, resource.FileName)
		if err != nil {
			return reliability.Wrap("unknown", err)
		}
		if err := os.WriteFile(stagedPath, resource.Content, 0o600); err != nil {
			return reliability.Wrap("unknown", fmt.Errorf("stage inbound attachment %s: %w", stagedPath, err))
		}

		item := domain.PendingInboundAttachment{
			AttachmentID:    uuid.NewString(),
			Platform:        platformID,
			ChatID:          inbound.ChatID,
			ThreadID:        inbound.ThreadID,
			Kind:            attachment.Kind,
			FileName:        firstNonEmpty(strings.TrimSpace(attachment.FileName), resource.FileName),
			MimeType:        firstNonEmpty(strings.TrimSpace(attachment.MimeType), resource.MimeType),
			SizeBytes:       resource.SizeBytes,
			PlatformKey:     strings.TrimSpace(attachment.PlatformKey),
			LocalPath:       stagedPath,
			SourceMessageID: firstNonEmpty(strings.TrimSpace(attachment.SourceMessageID), inbound.MessageID),
			DownloadState:   domain.AttachmentDownloadReady,
			ExpiresAt:       now.Add(defaultPendingAttachmentTTL).Format(time.RFC3339),
			CreatedAt:       now.Format(time.RFC3339),
			UpdatedAt:       now.Format(time.RFC3339),
		}
		if err := s.store.StorePendingInboundAttachment(ctx, item, maxPendingAttachmentsPerChat); err != nil {
			return reliability.Wrap("unknown", err)
		}
	}
	return nil
}

func (s *Service) loadPendingPromptAttachments(ctx context.Context, chatID string, threadID string) ([]domain.PromptAttachment, []string, error) {
	items, err := s.store.ListPendingInboundAttachments(ctx, platformID, chatID, threadID, time.Now().UTC().Format(time.RFC3339), maxPendingAttachmentsPerChat)
	if err != nil {
		return nil, nil, reliability.Wrap("unknown", err)
	}
	attachments := make([]domain.PromptAttachment, 0, len(items))
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if item.DownloadState != domain.AttachmentDownloadReady {
			continue
		}
		attachments = append(attachments, domain.PromptAttachment{
			Kind:            item.Kind,
			FileName:        item.FileName,
			MimeType:        item.MimeType,
			SizeBytes:       item.SizeBytes,
			PlatformKey:     item.PlatformKey,
			LocalPath:       item.LocalPath,
			SourceMessageID: item.SourceMessageID,
		})
		ids = append(ids, item.AttachmentID)
	}
	return attachments, ids, nil
}

func (s *Service) downloadInboundAttachment(ctx context.Context, attachment domain.InboundAttachment) (*DownloadedResource, error) {
	switch attachment.Kind {
	case domain.AttachmentKindImage:
		resource, err := s.gateway.DownloadImage(ctx, attachment.PlatformKey)
		if err != nil {
			return nil, reliability.Wrap(classifyFeishuError(err).Code, err)
		}
		if resource != nil && strings.TrimSpace(attachment.FileName) != "" {
			resource.FileName = strings.TrimSpace(attachment.FileName)
		}
		return resource, nil
	case domain.AttachmentKindFile:
		resource, err := s.gateway.DownloadFile(ctx, attachment.PlatformKey)
		if err != nil {
			return nil, reliability.Wrap(classifyFeishuError(err).Code, err)
		}
		if resource != nil && strings.TrimSpace(attachment.FileName) != "" {
			resource.FileName = strings.TrimSpace(attachment.FileName)
		}
		return resource, nil
	default:
		return nil, reliability.Wrap("payload_invalid", fmt.Errorf("unsupported feishu attachment kind %q", attachment.Kind))
	}
}

func stageDownloadedResource(baseDir string, chatID string, threadID string, fileName string) (string, error) {
	chatID = sanitizePathSegment(chatID)
	threadID = sanitizePathSegment(firstNonEmpty(threadID, "_root"))
	name := sanitizeFileName(firstNonEmpty(fileName, "attachment.bin"))
	dir := filepath.Join(baseDir, chatID, threadID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create staged attachment dir: %w", err)
	}
	return filepath.Join(dir, fmt.Sprintf("%s-%s", uuid.NewString(), name)), nil
}

func sanitizePathSegment(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "_"
	}
	replacer := strings.NewReplacer("\\", "_", "/", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return replacer.Replace(value)
}

func sanitizeFileName(value string) string {
	value = sanitizePathSegment(value)
	if value == "" {
		return "attachment.bin"
	}
	return value
}
