package app

import "context"

func (s *Store) Connectors(ctx context.Context, viewID int64) ([]Connector, error) {
	var rows []connectorModel
	if err := s.bun.NewSelect().
		Model(&rows).
		Where("view_id = ?", viewID).
		Order("id").
		Scan(ctx); err != nil {
		return nil, err
	}
	out := make([]Connector, 0, len(rows))
	for _, row := range rows {
		out = append(out, connectorFromModel(row))
	}
	return out, nil
}

func (s *Store) AllConnectors(ctx context.Context) ([]Connector, error) {
	var rows []connectorModel
	if err := s.bun.NewSelect().
		Model(&rows).
		Order("view_id").
		Order("id").
		Scan(ctx); err != nil {
		return nil, err
	}
	out := make([]Connector, 0, len(rows))
	for _, row := range rows {
		out = append(out, connectorFromModel(row))
	}
	return out, nil
}

func (s *Store) CreateConnector(ctx context.Context, input Connector) (Connector, error) {
	if err := s.ensureTagColors(ctx, input.Tags); err != nil {
		return Connector{}, err
	}
	now := nowString()
	row := &connectorModel{
		ViewID:          input.ViewID,
		SourceElementID: input.SourceElementID,
		TargetElementID: input.TargetElementID,
		Label:           input.Label,
		Description:     input.Description,
		Relationship:    input.Relationship,
		Direction:       normalizeDirection(&input.Direction),
		Style:           input.Style,
		URL:             input.URL,
		SourceHandle:    input.SourceHandle,
		TargetHandle:    input.TargetHandle,
		Tags:            jsonString(input.Tags, "[]"),
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	_, err := s.bun.NewInsert().Model(row).Exec(ctx)
	if err != nil {
		return Connector{}, err
	}
	return s.ConnectorByID(ctx, row.ID)
}

func (s *Store) ConnectorByID(ctx context.Context, id int64) (Connector, error) {
	var row connectorModel
	if err := s.bun.NewSelect().
		Model(&row).
		Where("id = ?", id).
		Scan(ctx); err != nil {
		return Connector{}, err
	}
	return connectorFromModel(row), nil
}

func (s *Store) UpdateConnector(ctx context.Context, id int64, patch Connector) (Connector, error) {
	var tagJSON any
	if patch.Tags != nil {
		if err := s.ensureTagColors(ctx, patch.Tags); err != nil {
			return Connector{}, err
		}
		tagJSON = jsonString(patch.Tags, "[]")
	}
	var row connectorModel
	if err := s.bun.NewRaw(`
		UPDATE connectors SET
			view_id = CASE WHEN ? = 0 THEN view_id ELSE ? END,
			source_element_id = CASE WHEN ? = 0 THEN source_element_id ELSE ? END,
			target_element_id = CASE WHEN ? = 0 THEN target_element_id ELSE ? END,
			label = COALESCE(?, label),
			description = COALESCE(?, description),
			relationship = COALESCE(?, relationship),
			direction = COALESCE(NULLIF(?, ''), direction),
			style = COALESCE(NULLIF(?, ''), style),
			url = COALESCE(?, url),
			source_handle = COALESCE(?, source_handle),
			target_handle = COALESCE(?, target_handle),
			tags = COALESCE(?, tags),
			updated_at = ?
		WHERE id = ?
		RETURNING id, view_id, source_element_id, target_element_id, label, description, relationship, direction, style, url, source_handle, target_handle, tags, created_at, updated_at`,
		patch.ViewID, patch.ViewID,
		patch.SourceElementID, patch.SourceElementID,
		patch.TargetElementID, patch.TargetElementID,
		patch.Label, patch.Description, patch.Relationship, patch.Direction, patch.Style, patch.URL, patch.SourceHandle, patch.TargetHandle, tagJSON,
		nowString(), id).
		Scan(ctx, &row); err != nil {
		return Connector{}, err
	}
	return connectorFromModel(row), nil
}

func (s *Store) DeleteConnector(ctx context.Context, id int64) error {
	_, err := s.bun.NewDelete().
		Model((*connectorModel)(nil)).
		Where("id = ?", id).
		Exec(ctx)
	return err
}
