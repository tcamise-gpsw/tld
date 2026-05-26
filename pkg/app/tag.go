package app

import (
	"context"
	"strings"

	"github.com/mertcikla/tld/v2/internal/tagcolors"
)

type Tag struct {
	Name        string  `json:"name"`
	Color       string  `json:"color"`
	Description *string `json:"description"`
}

func (s *Store) Layers(ctx context.Context, viewID int64) ([]ViewLayer, error) {
	var rows []viewLayerModel
	if err := s.bun.NewSelect().
		Model(&rows).
		Where("view_id = ?", viewID).
		Order("id").
		Scan(ctx); err != nil {
		return nil, err
	}
	out := make([]ViewLayer, 0, len(rows))
	for _, row := range rows {
		out = append(out, viewLayerFromModel(row))
	}
	return out, nil
}

func (s *Store) AllLayers(ctx context.Context) ([]ViewLayer, error) {
	var rows []viewLayerModel
	if err := s.bun.NewSelect().
		Model(&rows).
		Order("view_id").
		Order("id").
		Scan(ctx); err != nil {
		return nil, err
	}
	out := make([]ViewLayer, 0, len(rows))
	for _, row := range rows {
		out = append(out, viewLayerFromModel(row))
	}
	return out, nil
}

func (s *Store) CreateLayer(ctx context.Context, viewID int64, name string, tags []string, color *string) (ViewLayer, error) {
	if err := s.ensureTagColors(ctx, tags); err != nil {
		return ViewLayer{}, err
	}

	if color == nil || strings.TrimSpace(*color) == "" {
		// User said pick unused, usually means relative to existing layers in the same view or global tags.
		// Frontend uses tagColors.
		tagsMap, err := s.Tags(ctx)
		if err != nil {
			return ViewLayer{}, err
		}
		var usedColors []string
		for _, t := range tagsMap {
			usedColors = append(usedColors, t.Color)
		}
		// Also consider existing layers colors
		layers, err := s.Layers(ctx, viewID)
		if err == nil {
			for _, l := range layers {
				if l.Color != nil {
					usedColors = append(usedColors, *l.Color)
				}
			}
		}
		c := s.pickUnusedColor(ctx, usedColors)
		color = &c
	}

	now := nowString()
	row := &viewLayerModel{
		ViewID:    viewID,
		Name:      name,
		Tags:      jsonString(tags, "[]"),
		Color:     color,
		CreatedAt: now,
		UpdatedAt: now,
	}
	_, err := s.bun.NewInsert().Model(row).Exec(ctx)
	if err != nil {
		return ViewLayer{}, err
	}
	return s.LayerByID(ctx, row.ID)
}

func (s *Store) LayerByID(ctx context.Context, id int64) (ViewLayer, error) {
	var row viewLayerModel
	if err := s.bun.NewSelect().
		Model(&row).
		Where("id = ?", id).
		Scan(ctx); err != nil {
		return ViewLayer{}, err
	}
	return viewLayerFromModel(row), nil
}

func (s *Store) UpdateLayer(ctx context.Context, id int64, patch ViewLayer) (ViewLayer, error) {
	current, err := s.LayerByID(ctx, id)
	if err != nil {
		return ViewLayer{}, err
	}
	if patch.Name == "" {
		patch.Name = current.Name
	}
	if patch.Tags == nil {
		patch.Tags = current.Tags
	}
	if err := s.ensureTagColors(ctx, patch.Tags); err != nil {
		return ViewLayer{}, err
	}
	if patch.Color == nil {
		patch.Color = current.Color
	}
	_, err = s.bun.NewUpdate().
		Model((*viewLayerModel)(nil)).
		Set("name = ?", patch.Name).
		Set("tags = ?", jsonString(patch.Tags, "[]")).
		Set("color = ?", patch.Color).
		Set("updated_at = ?", nowString()).
		Where("id = ?", id).
		Exec(ctx)
	if err != nil {
		return ViewLayer{}, err
	}
	return s.LayerByID(ctx, id)
}

func (s *Store) DeleteLayer(ctx context.Context, id int64) error {
	_, err := s.bun.NewDelete().
		Model((*viewLayerModel)(nil)).
		Where("id = ?", id).
		Exec(ctx)
	return err
}

func (s *Store) Tags(ctx context.Context) (map[string]Tag, error) {
	var rows []tagModel
	if err := s.bun.NewSelect().
		Model(&rows).
		Order("name").
		Scan(ctx); err != nil {
		return nil, err
	}
	out := make(map[string]Tag, len(rows))
	for _, row := range rows {
		out[row.Name] = tagFromModel(row)
	}
	return out, nil
}

func (s *Store) UpdateTag(ctx context.Context, name, color string, description *string) error {
	row := &tagModel{Name: name, Color: color, Description: description}
	_, err := s.bun.NewInsert().
		Model(row).
		On("CONFLICT(name) DO UPDATE").
		Set("color = excluded.color").
		Set("description = excluded.description").
		Exec(ctx)
	return err
}

func (s *Store) pickUnusedColor(ctx context.Context, usedColors []string) string {
	return tagcolors.PickUnusedColor(usedColors)
}

func (s *Store) ensureTagColors(ctx context.Context, tags []string) error {
	return tagcolors.EnsureBun(ctx, s.bun, tags)
}
