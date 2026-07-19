package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

var ErrAgentConnectorNotFound = errors.New("agent connector principal not found")

func (s *Store) UpsertAgentConnectorBinding(ctx context.Context, binding domain.AgentConnectorBinding) (domain.AgentConnectorBinding, error) {
	binding.ConnectorID = strings.TrimSpace(binding.ConnectorID)
	binding.AgentID = strings.TrimSpace(binding.AgentID)
	binding.SessionMode = strings.TrimSpace(binding.SessionMode)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AgentConnectorBinding{}, err
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM bridge_channels WHERE channel_id = ?`, binding.ConnectorID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return domain.AgentConnectorBinding{}, ErrAgentConnectorNotFound
	} else if err != nil {
		return domain.AgentConnectorBinding{}, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM agent_profiles WHERE agent_id = ?`, binding.AgentID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return domain.AgentConnectorBinding{}, ErrAgentRoomNotFound
	} else if err != nil {
		return domain.AgentConnectorBinding{}, err
	}
	now := nowRFC3339()
	_, err = tx.ExecContext(ctx, `INSERT INTO agent_connector_bindings (connector_id, agent_id, session_mode, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(connector_id) DO UPDATE SET agent_id = excluded.agent_id, session_mode = excluded.session_mode, updated_at = excluded.updated_at`,
		binding.ConnectorID, binding.AgentID, binding.SessionMode, now, now)
	if err != nil {
		return domain.AgentConnectorBinding{}, fmt.Errorf("failed to bind connector to agent: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return domain.AgentConnectorBinding{}, err
	}
	item, err := s.GetAgentConnectorBinding(ctx, binding.ConnectorID)
	if err != nil {
		return domain.AgentConnectorBinding{}, err
	}
	if item == nil {
		return domain.AgentConnectorBinding{}, ErrAgentRoomNotFound
	}
	return *item, nil
}

func (s *Store) GetAgentConnectorBinding(ctx context.Context, connectorID string) (*domain.AgentConnectorBinding, error) {
	var item domain.AgentConnectorBinding
	err := s.db.QueryRowContext(ctx, `SELECT connector_id, agent_id, session_mode, created_at, updated_at FROM agent_connector_bindings WHERE connector_id = ?`, strings.TrimSpace(connectorID)).Scan(
		&item.ConnectorID, &item.AgentID, &item.SessionMode, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &item, err
}

func (s *Store) ListAgentConnectorBindings(ctx context.Context) ([]domain.AgentConnectorBinding, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT connector_id, agent_id, session_mode, created_at, updated_at FROM agent_connector_bindings ORDER BY connector_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.AgentConnectorBinding{}
	for rows.Next() {
		var item domain.AgentConnectorBinding
		if err := rows.Scan(&item.ConnectorID, &item.AgentID, &item.SessionMode, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) DeleteAgentConnectorBinding(ctx context.Context, connectorID string) (bool, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM agent_connector_bindings WHERE connector_id = ?`, strings.TrimSpace(connectorID))
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected == 1, err
}

func (s *Store) ResolveConnectorAgent(ctx context.Context, connectorID string) (*domain.ConnectorAgentContext, error) {
	var item domain.ConnectorAgentContext
	var controls string
	err := s.db.QueryRowContext(ctx, `SELECT binding.connector_id, binding.agent_id, binding.session_mode,
		profile.role_prompt, profile.default_work_dir, profile.session_policy, ifnull(profile.pinned_session_id, ''),
		ifnull(session.work_dir, ''), profile.runtime_controls_json
		FROM agent_connector_bindings binding
		JOIN agent_profiles profile ON profile.agent_id = binding.agent_id AND profile.enabled = 1
		LEFT JOIN bridge_sessions session ON session.kimi_session_id = profile.pinned_session_id
		WHERE binding.connector_id = ?`, strings.TrimSpace(connectorID)).Scan(
		&item.ConnectorID, &item.AgentID, &item.SessionMode, &item.RolePrompt, &item.DefaultWorkDir,
		&item.SessionPolicy, &item.PinnedSessionID, &item.PinnedWorkDir, &controls)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	item.RuntimeControls = []byte(controls)
	return &item, nil
}
