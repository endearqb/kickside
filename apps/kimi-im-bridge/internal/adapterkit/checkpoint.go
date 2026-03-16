package adapterkit

import "strings"

type CheckpointState struct {
	Fetched   string
	Committed string
}

type CheckpointPolicy interface {
	ShouldSkip(state CheckpointState, incoming string) bool
	MarkFetched(state CheckpointState, incoming string) CheckpointState
	MarkCommitted(state CheckpointState, incoming string) CheckpointState
}

type StringCheckpointPolicy struct{}

func (StringCheckpointPolicy) ShouldSkip(state CheckpointState, incoming string) bool {
	incoming = strings.TrimSpace(incoming)
	if incoming == "" {
		return false
	}
	return incoming == strings.TrimSpace(state.Committed)
}

func (StringCheckpointPolicy) MarkFetched(state CheckpointState, incoming string) CheckpointState {
	state.Fetched = strings.TrimSpace(incoming)
	return state
}

func (StringCheckpointPolicy) MarkCommitted(state CheckpointState, incoming string) CheckpointState {
	incoming = strings.TrimSpace(incoming)
	state.Fetched = incoming
	state.Committed = incoming
	return state
}
