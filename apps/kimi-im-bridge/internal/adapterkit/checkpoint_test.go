package adapterkit

import "testing"

func TestStringCheckpointPolicy(t *testing.T) {
	t.Parallel()

	policy := StringCheckpointPolicy{}
	state := CheckpointState{Committed: "evt-1"}
	if !policy.ShouldSkip(state, "evt-1") {
		t.Fatalf("expected committed event to be skipped")
	}
	if policy.ShouldSkip(state, "evt-2") {
		t.Fatalf("expected fresh event to be processed")
	}

	state = policy.MarkFetched(state, "evt-2")
	if state.Fetched != "evt-2" || state.Committed != "evt-1" {
		t.Fatalf("unexpected fetched state: %+v", state)
	}

	state = policy.MarkCommitted(state, "evt-2")
	if state.Fetched != "evt-2" || state.Committed != "evt-2" {
		t.Fatalf("unexpected committed state: %+v", state)
	}
}
