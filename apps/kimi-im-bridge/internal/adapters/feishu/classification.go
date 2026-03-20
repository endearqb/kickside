package feishu

import (
	"errors"
	"net"
	"regexp"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
)

var feishuWhitespacePattern = regexp.MustCompile(`\s+`)

func classifyFeishuError(err error) reliability.Classification {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		message := strings.ToLower(apiErr.Message)
		switch {
		case strings.Contains(message, "app secret"),
			strings.Contains(message, "appid"),
			strings.Contains(message, "app id"),
			strings.Contains(message, "tenant_access_token"),
			strings.Contains(message, "app_access_token"),
			strings.Contains(message, "auth"),
			strings.Contains(message, "credential"):
			return reliability.Classification{Code: "invalid_credentials"}
		case strings.Contains(message, "permission"),
			strings.Contains(message, "forbidden"),
			strings.Contains(message, "access denied"):
			return reliability.Classification{Code: "permission_denied"}
		case strings.Contains(message, "frequency"),
			strings.Contains(message, "too many"),
			strings.Contains(message, "rate limit"),
			strings.Contains(message, "flow control"):
			return reliability.Classification{
				Code:      "rate_limited",
				Retryable: true,
			}
		case strings.Contains(message, "invalid"),
			strings.Contains(message, "illegal"),
			strings.Contains(message, "content"),
			strings.Contains(message, "param"):
			return reliability.Classification{Code: "payload_invalid"}
		case apiErr.HTTPStatus >= 500 || strings.Contains(message, "internal error") || strings.Contains(message, "system busy"):
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
	case strings.Contains(lower, "aborted by the software in your host machine"),
		strings.Contains(lower, "wsasend:"),
		strings.Contains(lower, "context deadline exceeded"),
		strings.Contains(lower, "connection reset"),
		strings.Contains(lower, "connection refused"),
		strings.Contains(lower, "tls handshake timeout"),
		strings.Contains(lower, "unexpected eof"),
		strings.Contains(lower, "timeout"),
		strings.Contains(lower, "websocket: close 1006"),
		strings.Contains(lower, "broken pipe"):
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

func feishuRecoveryHint(code string, err error) string {
	lower := strings.ToLower(strings.TrimSpace(errString(err)))
	switch {
	case code == "invalid_credentials":
		return "invalid_credentials"
	case code == "permission_denied":
		return "permission_denied"
	case strings.Contains(lower, "aborted by the software in your host machine"),
		strings.Contains(lower, "wsasend:"):
		return "host_connection_aborted"
	case strings.Contains(lower, "tls handshake timeout"):
		return "tls_timeout"
	case strings.Contains(lower, "connection reset"):
		return "connection_reset"
	default:
		return ""
	}
}

func feishuFailureFingerprint(code string, err error) string {
	normalized := normalizeFeishuErrorMessage(err)
	if normalized == "" {
		return strings.TrimSpace(code)
	}
	if strings.TrimSpace(code) == "" {
		return normalized
	}
	return strings.TrimSpace(code) + "|" + normalized
}

func normalizeFeishuErrorMessage(err error) string {
	lower := strings.ToLower(strings.TrimSpace(errString(err)))
	if lower == "" {
		return ""
	}
	switch {
	case strings.Contains(lower, "aborted by the software in your host machine"),
		strings.Contains(lower, "wsasend:"):
		return "host_connection_aborted"
	case strings.Contains(lower, "tls handshake timeout"):
		return "tls_timeout"
	case strings.Contains(lower, "connection reset"):
		return "connection_reset"
	case strings.Contains(lower, "connection refused"):
		return "connection_refused"
	case strings.Contains(lower, "context deadline exceeded"):
		return "context_deadline_exceeded"
	case strings.Contains(lower, "unexpected eof"):
		return "unexpected_eof"
	case strings.Contains(lower, "timeout"):
		return "timeout"
	case strings.Contains(lower, "broken pipe"):
		return "broken_pipe"
	default:
		return feishuWhitespacePattern.ReplaceAllString(lower, " ")
	}
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
