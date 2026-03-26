package adapterkit

import "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"

type NormalizedInbound struct {
	MessageID   string
	ConnectorID string
	Platform    string
	AccountID   string
	ChatID      string
	ThreadID    string
	SenderID    string
	SenderName  string
	Text        string
	Mentions    []string
	Attachments []domain.InboundAttachment
	ReceivedAt  string
	RawRef      string
	BindingKey  domain.BindingKey
}

func FromDomainInbound(inbound domain.InboundMessage, key domain.BindingKey) NormalizedInbound {
	return NormalizedInbound{
		MessageID:   inbound.MessageID,
		ConnectorID: inbound.ConnectorID,
		Platform:    inbound.Platform,
		AccountID:   inbound.AccountID,
		ChatID:      inbound.ChatID,
		ThreadID:    inbound.ThreadID,
		SenderID:    inbound.SenderID,
		SenderName:  inbound.SenderName,
		Text:        inbound.Text,
		Mentions:    append([]string(nil), inbound.Mentions...),
		Attachments: append([]domain.InboundAttachment(nil), inbound.Attachments...),
		ReceivedAt:  inbound.ReceivedAt,
		RawRef:      inbound.RawRef,
		BindingKey:  key,
	}
}
