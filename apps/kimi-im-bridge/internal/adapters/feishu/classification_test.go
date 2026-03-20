package feishu

import (
	"fmt"
	"testing"
)

func TestClassifyFeishuErrorHostConnectionAborted(t *testing.T) {
	t.Parallel()

	err := fmt.Errorf("write tcp 198.18.0.1:6219->183.136.203.179:443: wsasend: An established connection was aborted by the software in your host machine.")
	classification := classifyFeishuError(err)
	if classification.Code != "transient_network" || !classification.Retryable {
		t.Fatalf("expected transient_network retryable classification, got %+v", classification)
	}
	if hint := feishuRecoveryHint(classification.Code, err); hint != "host_connection_aborted" {
		t.Fatalf("expected host_connection_aborted hint, got %q", hint)
	}
	if fingerprint := feishuFailureFingerprint(classification.Code, err); fingerprint != "transient_network|host_connection_aborted" {
		t.Fatalf("unexpected fingerprint %q", fingerprint)
	}
}
