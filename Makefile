TASK = go tool task

.PHONY: setup-hooks frontend-deps frontend-build lint-be lint-fe be fe dev dev-stop proto test build go run clean

setup-hooks:
	$(TASK) setup-hooks

frontend-deps:
	$(TASK) frontend-deps

frontend-build:
	$(TASK) frontend-build

lint-be:
	$(TASK) lint-be

lint-fe:
	$(TASK) lint-fe

be:
	$(TASK) be

fe:
	$(TASK) fe

dev:
	$(TASK) dev

dev-stop:
	$(TASK) dev-stop

proto:
	$(TASK) proto

test:
	$(TASK) test

build:
	$(TASK) build

go:
	$(TASK) go

run:
	$(TASK) run

clean:
	$(TASK) clean
