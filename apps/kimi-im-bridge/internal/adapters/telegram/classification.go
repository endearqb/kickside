package telegram

import (
	"errors"
	"net"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
)

func classifyTelegramError(err error) reliability.Classification {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		switch {
		case apiErr.IsInvalidToken():
			return reliability.Classification{Code: "invalid_credentials"}
		case apiErr.IsPermissionError():
			return reliability.Classification{Code: "permission_denied"}
		case apiErr.IsRateLimited():
			return reliability.Classification{
				Code:       "rate_limited",
				Retryable:  true,
				RetryAfter: apiErr.RetryAfter(),
			}
		case apiErr.IsParseModeError() || apiErr.ErrorCode == 400:
			return reliability.Classification{Code: "payload_invalid"}
		case apiErr.IsServerError():
			return reliability.Classification{
				Code:      "platform_unavailable",
				Retryable: true,
			}
		default:
			return reliability.Classification{Code: "delivery_failed"}
		}
	}

	var netErr net.Error
	if errors.As(err, &netErr) {
		return reliability.Classification{
			Code:      "transient_network",
			Retryable: true,
		}
	}

	lower := strings.ToLower(err.Error())
	switch {
	case strings.Contains(lower, "context deadline exceeded"),
		strings.Contains(lower, "connection reset"),
		strings.Contains(lower, "connection refused"),
		strings.Contains(lower, "tls handshake timeout"),
		strings.Contains(lower, "broken pipe"),
		strings.Contains(lower, "unexpected eof"),
		strings.Contains(lower, "timeout"):
		return reliability.Classification{
			Code:      "transient_network",
			Retryable: true,
		}
	}

	code := reliability.CodeOf(err, "")
	switch code {
	case "rate_limited", "transient_network", "platform_unavailable":
		return reliability.Classification{Code: code, Retryable: true}
	case "invalid_credentials", "permission_denied", "payload_invalid", "delivery_failed":
		return reliability.Classification{Code: code}
	}

	return reliability.Classification{Code: "unknown"}
}
