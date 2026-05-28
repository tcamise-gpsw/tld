package lsp

import (
	"fmt"
	"os/exec"
	"strings"
	"unicode"

	"github.com/mertcikla/tld/v2/internal/analyzer"
)

type LookPathFunc func(file string) (string, error)

const (
	CommandSourceDefault  = "default"
	CommandSourceOverride = "override"
)

type ServerCommand struct {
	Executable string
	Args       []string
}

type ResolvedCommand struct {
	Path          string
	Args          []string
	CommandSource string
}

type ErrServerCommandInvalid struct {
	Language analyzer.Language
	Command  string
	Err      error
}

func (e ErrServerCommandInvalid) Error() string {
	return fmt.Sprintf("invalid configured LSP command for %s %q: %v", e.Language, e.Command, e.Err)
}

func (e ErrServerCommandInvalid) Unwrap() error {
	return e.Err
}

type ErrServerNotConfigured struct {
	Language analyzer.Language
}

func (e ErrServerNotConfigured) Error() string {
	return fmt.Sprintf("no LSP server configured for %s", e.Language)
}

type ErrServerNotFound struct {
	Language      analyzer.Language
	Candidates    []ServerCommand
	CommandSource string
}

func (e ErrServerNotFound) Error() string {
	parts := make([]string, 0, len(e.Candidates))
	for _, candidate := range e.Candidates {
		parts = append(parts, candidate.Display())
	}
	if e.CommandSource == CommandSourceOverride {
		return fmt.Sprintf("configured LSP server for %s not found (tried override: %s)", e.Language, strings.Join(parts, ", "))
	}
	return fmt.Sprintf("no installed LSP server found for %s (tried: %s)", e.Language, strings.Join(parts, ", "))
}

func (c ServerCommand) Display() string {
	if len(c.Args) == 0 {
		return c.Executable
	}
	return c.Executable + " " + strings.Join(c.Args, " ")
}

func DefaultCommands(language analyzer.Language) []ServerCommand {
	commands, ok := defaultCommands[language]
	if !ok {
		return nil
	}
	cloned := make([]ServerCommand, 0, len(commands))
	for _, command := range commands {
		cloned = append(cloned, ServerCommand{
			Executable: command.Executable,
			Args:       append([]string{}, command.Args...),
		})
	}
	return cloned
}

func ResolveServerCommand(language analyzer.Language) (ResolvedCommand, error) {
	return ResolveServerCommandWithLookPath(language, exec.LookPath)
}

func ResolveServerCommandWithLookPath(language analyzer.Language, lookPath LookPathFunc) (ResolvedCommand, error) {
	return ResolveServerCommandWithOverrides(language, nil, lookPath)
}

func ResolveServerCommandWithOverrides(language analyzer.Language, overrides map[analyzer.Language]string, lookPath LookPathFunc) (ResolvedCommand, error) {
	if lookPath == nil {
		lookPath = exec.LookPath
	}
	if override := strings.TrimSpace(overrides[language]); override != "" {
		command, err := ParseServerCommand(override)
		if err != nil {
			return ResolvedCommand{}, ErrServerCommandInvalid{Language: language, Command: override, Err: err}
		}
		path, err := lookPath(command.Executable)
		if err != nil {
			return ResolvedCommand{}, ErrServerNotFound{Language: language, Candidates: []ServerCommand{command}, CommandSource: CommandSourceOverride}
		}
		return ResolvedCommand{Path: path, Args: append([]string{}, command.Args...), CommandSource: CommandSourceOverride}, nil
	}
	commands := DefaultCommands(language)
	if len(commands) == 0 {
		return ResolvedCommand{}, ErrServerNotConfigured{Language: language}
	}
	for _, command := range commands {
		path, err := lookPath(command.Executable)
		if err == nil {
			return ResolvedCommand{Path: path, Args: append([]string{}, command.Args...), CommandSource: CommandSourceDefault}, nil
		}
	}
	return ResolvedCommand{}, ErrServerNotFound{Language: language, Candidates: commands, CommandSource: CommandSourceDefault}
}

func ParseServerCommand(value string) (ServerCommand, error) {
	parts, err := splitCommandFields(value)
	if err != nil {
		return ServerCommand{}, err
	}
	if len(parts) == 0 {
		return ServerCommand{}, fmt.Errorf("command is empty")
	}
	return ServerCommand{Executable: parts[0], Args: append([]string{}, parts[1:]...)}, nil
}

func splitCommandFields(value string) ([]string, error) {
	var fields []string
	var current strings.Builder
	inSingle := false
	inDouble := false
	escaped := false
	tokenStarted := false
	for _, r := range value {
		switch {
		case escaped:
			current.WriteRune(r)
			tokenStarted = true
			escaped = false
		case r == '\\' && !inSingle:
			escaped = true
			tokenStarted = true
		case r == '\'' && !inDouble:
			inSingle = !inSingle
			tokenStarted = true
		case r == '"' && !inSingle:
			inDouble = !inDouble
			tokenStarted = true
		case unicode.IsSpace(r) && !inSingle && !inDouble:
			if tokenStarted {
				fields = append(fields, current.String())
				current.Reset()
				tokenStarted = false
			}
		default:
			current.WriteRune(r)
			tokenStarted = true
		}
	}
	if escaped {
		return nil, fmt.Errorf("unfinished escape")
	}
	if inSingle || inDouble {
		return nil, fmt.Errorf("unterminated quote")
	}
	if tokenStarted {
		fields = append(fields, current.String())
	}
	return fields, nil
}

func NormalizeOverrideCommands(values map[string]string) map[analyzer.Language]string {
	out := map[analyzer.Language]string{}
	for key, value := range values {
		language := analyzer.Language(strings.ToLower(strings.TrimSpace(key)))
		if len(DefaultCommands(language)) == 0 {
			continue
		}
		if command := strings.TrimSpace(value); command != "" {
			out[language] = command
		}
	}
	return out
}

var defaultCommands = map[analyzer.Language][]ServerCommand{
	analyzer.LanguageGo: {
		{Executable: "gopls"},
	},
	analyzer.LanguagePython: {
		{Executable: "pyright-langserver", Args: []string{"--stdio"}},
	},
	analyzer.LanguageRust: {
		{Executable: "rust-analyzer"},
	},
	analyzer.LanguageJava: {
		{Executable: "jdtls"},
	},
	analyzer.LanguageTypeScript: {
		{Executable: "typescript-language-server", Args: []string{"--stdio"}},
	},
	analyzer.LanguageJavaScript: {
		{Executable: "typescript-language-server", Args: []string{"--stdio"}},
	},
	analyzer.LanguageC: {
		{Executable: "clangd"},
	},
	analyzer.LanguageCPP: {
		{Executable: "clangd"},
	},
}
