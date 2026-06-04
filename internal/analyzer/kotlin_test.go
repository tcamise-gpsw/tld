package analyzer

import (
	"context"
	"path/filepath"
	"testing"
)

func TestNewService_ExtractPath_UsesKotlinTreeSitter(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "CameraController.kt")
	writeAnalyzerTestFile(t, filePath, `package com.gopro.katalyst.connect.core

import com.gopro.katalyst.connect.domain.Preset

class CameraController {
    constructor()

    fun applyPreset(preset: Preset) {
        helper()
        preset.name.toString()
    }

    private fun helper() {}
}

interface CameraGateway {
    fun connect()
}

object CameraDefaults {
    fun defaultPreset(): Preset = Preset("wide")
}

fun createController(): CameraController = CameraController()
`)

	result, err := NewService().ExtractPath(context.Background(), filePath, nil, nil)
	if err != nil {
		t.Fatalf("ExtractPath kotlin: %v", err)
	}
	if len(result.Symbols) < 8 {
		t.Fatalf("symbols = %d, want at least 8: %+v", len(result.Symbols), result.Symbols)
	}

	symbolKinds := make(map[string]string, len(result.Symbols))
	parents := make(map[string]string, len(result.Symbols))
	for _, sym := range result.Symbols {
		symbolKinds[sym.Name] = sym.Kind
		parents[sym.Name] = sym.Parent
	}
	if symbolKinds["CameraController"] != "class" {
		t.Fatalf("CameraController kind = %q", symbolKinds["CameraController"])
	}
	if symbolKinds["CameraGateway"] != "interface" {
		t.Fatalf("CameraGateway kind = %q", symbolKinds["CameraGateway"])
	}
	if symbolKinds["CameraDefaults"] != "class" {
		t.Fatalf("CameraDefaults kind = %q", symbolKinds["CameraDefaults"])
	}
	if symbolKinds["applyPreset"] != "method" || parents["applyPreset"] != "CameraController" {
		t.Fatalf("applyPreset = kind %q parent %q", symbolKinds["applyPreset"], parents["applyPreset"])
	}
	if symbolKinds["helper"] != "method" || parents["helper"] != "CameraController" {
		t.Fatalf("helper = kind %q parent %q", symbolKinds["helper"], parents["helper"])
	}
	if symbolKinds["constructor"] != "constructor" || parents["constructor"] != "CameraController" {
		t.Fatalf("constructor = kind %q parent %q", symbolKinds["constructor"], parents["constructor"])
	}
	if symbolKinds["createController"] != "function" || parents["createController"] != "" {
		t.Fatalf("createController = kind %q parent %q", symbolKinds["createController"], parents["createController"])
	}

	refNames := make([]string, 0, len(result.Refs))
	foundImport := false
	for _, ref := range result.Refs {
		refNames = append(refNames, ref.Name)
		if ref.Kind == "import" && ref.Name == "Preset" && ref.TargetPath == "com/gopro/katalyst/connect/domain" {
			foundImport = true
		}
	}
	if !foundImport {
		t.Fatalf("expected Preset import ref with package target path, got %+v", result.Refs)
	}
	if !containsString(refNames, "helper") || !containsString(refNames, "toString") || !containsString(refNames, "CameraController") {
		t.Fatalf("unexpected refs: %+v", result.Refs)
	}
}

func TestNewService_ExtractPath_HandlesKotlinScript(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "build.kts")
	writeAnalyzerTestFile(t, filePath, "fun configure() { println(\"ready\") }\nconfigure()\n")

	result, err := NewService().ExtractPath(context.Background(), filePath, nil, nil)
	if err != nil {
		t.Fatalf("ExtractPath kotlin script: %v", err)
	}
	if len(result.Symbols) != 1 {
		t.Fatalf("symbols = %d, want 1: %+v", len(result.Symbols), result.Symbols)
	}
	if got := result.Symbols[0].Name; got != "configure" {
		t.Fatalf("symbol name = %q, want configure", got)
	}
	if len(result.Refs) < 2 {
		t.Fatalf("refs = %d, want at least 2: %+v", len(result.Refs), result.Refs)
	}
}
