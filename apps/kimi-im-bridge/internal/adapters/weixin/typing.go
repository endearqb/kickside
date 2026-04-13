package weixin

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	bridgeconfig "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

const weixinTypingKeepaliveInterval = 5 * time.Second

type typingSession struct {
	stopOnce sync.Once
	stopFunc func()
}

func (session *typingSession) stop() {
	if session == nil {
		return
	}
	session.stopOnce.Do(func() {
		if session.stopFunc != nil {
			session.stopFunc()
		}
	})
}

func (s *Service) startTypingSession(
	ctx context.Context,
	binding domain.SessionBinding,
) (*typingSession, error) {
	replyMode := normalizeWeixinReplyMode(s.config.ReplyMode)
	if replyMode == bridgeconfig.WeixinReplyModeFinalOnly {
		return nil, nil
	}
	if replyMode == bridgeconfig.WeixinReplyModeStreamingExperimental {
		s.logf(
			"weixin streaming_experimental is not implemented yet; falling back to typing + final connector=%s",
			s.connectorID(),
		)
	}

	ticket, err := s.resolveTypingTicket(ctx, binding)
	if err != nil || strings.TrimSpace(ticket) == "" {
		return nil, err
	}
	if err := s.sendTyping(ctx, binding.Key.ChatID, ticket, 1); err != nil {
		return nil, err
	}

	sessionCtx, cancel := context.WithCancel(context.Background())
	go s.keepTypingAlive(sessionCtx, binding.Key.ChatID, ticket)

	return &typingSession{
		stopFunc: func() {
			cancel()
			stopCtx, stopCancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer stopCancel()
			_ = s.sendTyping(stopCtx, binding.Key.ChatID, ticket, 2)
		},
	}, nil
}

func (s *Service) keepTypingAlive(ctx context.Context, userID string, ticket string) {
	ticker := time.NewTicker(weixinTypingKeepaliveInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			keepaliveCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = s.sendTyping(keepaliveCtx, userID, ticket, 1)
			cancel()
		}
	}
}

func (s *Service) resolveTypingTicket(ctx context.Context, binding domain.SessionBinding) (string, error) {
	response, err := s.client.GetConfig(ctx, GetConfigRequest{
		IlinkUserID:  strings.TrimSpace(binding.Key.ChatID),
		ContextToken: strings.TrimSpace(binding.ContextToken),
		BaseInfo:     defaultBaseInfo(),
	})
	if err != nil {
		return "", err
	}
	if response.Ret != 0 {
		return "", fmt.Errorf("weixin getconfig returned ret=%d: %s", response.Ret, strings.TrimSpace(response.ErrMsg))
	}
	return strings.TrimSpace(response.TypingTicket), nil
}

func (s *Service) sendTyping(ctx context.Context, userID string, ticket string, status int) error {
	return s.client.SendTyping(ctx, SendTypingRequest{
		IlinkUserID:  strings.TrimSpace(userID),
		TypingTicket: strings.TrimSpace(ticket),
		Status:       status,
		BaseInfo:     defaultBaseInfo(),
	})
}