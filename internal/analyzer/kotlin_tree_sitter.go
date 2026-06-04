package analyzer

import (
	"context"
	"fmt"
	"path"
	"strings"

	"github.com/odvcencio/gotreesitter"
)

type kotlinParser struct{}

func (p *kotlinParser) ParseFile(ctx context.Context, path string, source []byte) (*Result, error) {
	parsed, err := parseTree(ctx, path, source)
	if err != nil {
		return nil, fmt.Errorf("parse kotlin tree-sitter source: %w", err)
	}
	defer parsed.Close()

	result := &Result{}
	root := parsed.tree.RootNode()
	p.walkNode(root, parsed.lang, source, path, "", result)
	return result, nil
}

func (p *kotlinParser) walkNode(node *gotreesitter.Node, lang *gotreesitter.Language, source []byte, path, parent string, result *Result) {
	if node == nil {
		return
	}

	nextParent := parent
	switch nodeKind(node, lang) {
	case "class_declaration":
		nextParent = p.appendType(node, lang, source, path, parent, kotlinClassKind(node, lang, source), result)
	case "infix_expression":
		if kotlinIsObjectExpression(node, lang) {
			nextParent = p.appendObject(node, source, path, parent, result)
		}
	case "function_declaration":
		p.appendFunction(node, lang, source, path, parent, result)
	case "secondary_constructor":
		p.appendConstructor(node, path, parent, result)
	case "import_header":
		p.appendImport(node, lang, source, path, result)
	case "call_expression":
		p.appendCall(node, lang, source, path, result)
	}

	for _, child := range namedChildren(node) {
		p.walkNode(child, lang, source, path, nextParent, result)
	}
}

func (p *kotlinParser) appendType(node *gotreesitter.Node, lang *gotreesitter.Language, source []byte, path, parent, kind string, result *Result) string {
	nameNode := kotlinTypeNameNode(node, lang)
	if nameNode == nil {
		return parent
	}
	name := nodeText(nameNode, source)
	result.Symbols = append(result.Symbols, Symbol{
		Name:     name,
		Kind:     kind,
		FilePath: path,
		Line:     int(nameNode.StartPoint().Row) + 1,
		EndLine:  int(node.EndPoint().Row) + 1,
		Parent:   parent,
	})
	return name
}

func (p *kotlinParser) appendObject(node *gotreesitter.Node, source []byte, path, parent string, result *Result) string {
	children := namedChildren(node)
	if len(children) < 2 {
		return parent
	}
	nameNode := children[1]
	name := nodeText(nameNode, source)
	if name == "" {
		return parent
	}
	result.Symbols = append(result.Symbols, Symbol{
		Name:     name,
		Kind:     "class",
		FilePath: path,
		Line:     int(nameNode.StartPoint().Row) + 1,
		EndLine:  int(node.EndPoint().Row) + 1,
		Parent:   parent,
	})
	return name
}

func (p *kotlinParser) appendFunction(node *gotreesitter.Node, lang *gotreesitter.Language, source []byte, path, parent string, result *Result) {
	nameNode := kotlinSimpleIdentifierChild(node, lang)
	if nameNode == nil {
		return
	}
	kind := "function"
	if parent != "" {
		kind = "method"
	}
	result.Symbols = append(result.Symbols, Symbol{
		Name:     nodeText(nameNode, source),
		Kind:     kind,
		FilePath: path,
		Line:     int(nameNode.StartPoint().Row) + 1,
		EndLine:  int(node.EndPoint().Row) + 1,
		Parent:   parent,
	})
}

func (p *kotlinParser) appendConstructor(node *gotreesitter.Node, path, parent string, result *Result) {
	if parent == "" {
		return
	}
	result.Symbols = append(result.Symbols, Symbol{
		Name:     "constructor",
		Kind:     "constructor",
		FilePath: path,
		Line:     int(node.StartPoint().Row) + 1,
		EndLine:  int(node.EndPoint().Row) + 1,
		Parent:   parent,
	})
}

func (p *kotlinParser) appendImport(node *gotreesitter.Node, lang *gotreesitter.Language, source []byte, filePath string, result *Result) {
	identifier := kotlinFirstChildOfKind(node, lang, "identifier")
	if identifier == nil {
		return
	}
	importPath := strings.TrimSpace(nodeText(identifier, source))
	if importPath == "" {
		return
	}
	name := importPath
	targetPath := ""
	if index := strings.LastIndex(importPath, "."); index >= 0 {
		name = importPath[index+1:]
		targetPath = strings.ReplaceAll(importPath[:index], ".", "/")
	}
	if targetPath == "" {
		targetPath = strings.ReplaceAll(importPath, ".", "/")
	}
	result.Refs = append(result.Refs, Ref{
		Name:       name,
		Kind:       "import",
		TargetPath: targetPath,
		FilePath:   filePath,
		Line:       int(identifier.StartPoint().Row) + 1,
		Column:     int(identifier.StartPoint().Column) + 1,
	})
}

func (p *kotlinParser) appendCall(node *gotreesitter.Node, lang *gotreesitter.Language, source []byte, path string, result *Result) {
	callee := kotlinCallTarget(node, lang)
	if callee == nil {
		return
	}
	name := kotlinCallName(callee, lang, source)
	if name == "" {
		return
	}
	result.Refs = append(result.Refs, Ref{
		Name:     name,
		Kind:     "call",
		FilePath: path,
		Line:     int(callee.StartPoint().Row) + 1,
		Column:   int(callee.StartPoint().Column) + 1,
	})
}

func kotlinClassKind(node *gotreesitter.Node, lang *gotreesitter.Language, source []byte) string {
	text := strings.TrimSpace(nodeText(node, source))
	if strings.HasPrefix(text, "interface ") || strings.HasPrefix(text, "fun interface ") {
		return "interface"
	}
	if strings.HasPrefix(text, "enum class ") {
		return "enum"
	}
	for _, child := range namedChildren(node) {
		if nodeKind(child, lang) != "modifiers" {
			continue
		}
		if strings.Contains(nodeText(child, source), "enum") {
			return "enum"
		}
	}
	return "class"
}

func kotlinIsObjectExpression(node *gotreesitter.Node, lang *gotreesitter.Language) bool {
	children := namedChildren(node)
	return len(children) >= 3 && nodeKind(children[0], lang) == "object_literal" && nodeKind(children[1], lang) == "simple_identifier"
}

func kotlinTypeNameNode(node *gotreesitter.Node, lang *gotreesitter.Language) *gotreesitter.Node {
	if nameNode := childByFieldName(node, lang, "name"); nameNode != nil {
		return nameNode
	}
	for _, child := range namedChildren(node) {
		if nodeKind(child, lang) == "type_identifier" {
			return child
		}
	}
	return nil
}

func kotlinSimpleIdentifierChild(node *gotreesitter.Node, lang *gotreesitter.Language) *gotreesitter.Node {
	for _, child := range namedChildren(node) {
		if nodeKind(child, lang) == "simple_identifier" {
			return child
		}
	}
	return childByFieldName(node, lang, "name")
}

func kotlinFirstChildOfKind(node *gotreesitter.Node, lang *gotreesitter.Language, kind string) *gotreesitter.Node {
	for _, child := range namedChildren(node) {
		if nodeKind(child, lang) == kind {
			return child
		}
	}
	return nil
}

func kotlinCallTarget(node *gotreesitter.Node, lang *gotreesitter.Language) *gotreesitter.Node {
	children := namedChildren(node)
	if len(children) == 0 {
		return nil
	}
	for _, child := range children {
		if nodeKind(child, lang) == "call_suffix" {
			break
		}
		return child
	}
	return nil
}

func kotlinCallName(node *gotreesitter.Node, lang *gotreesitter.Language, source []byte) string {
	if node == nil {
		return ""
	}
	switch nodeKind(node, lang) {
	case "simple_identifier", "type_identifier":
		return nodeText(node, source)
	case "navigation_expression", "navigation_suffix":
		var name string
		for _, child := range namedChildren(node) {
			if childName := kotlinCallName(child, lang, source); childName != "" {
				name = childName
			}
		}
		return name
	}
	text := strings.TrimSpace(nodeText(node, source))
	if text == "" {
		return ""
	}
	if index := strings.LastIndex(text, "."); index >= 0 {
		text = text[index+1:]
	}
	if index := strings.Index(text, "("); index >= 0 {
		text = text[:index]
	}
	return strings.TrimSpace(path.Base(text))
}
