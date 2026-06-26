# 00-project.md

# Ghost Bot - Project Foundation

> This document defines the architecture, standards, development workflow and engineering principles for the entire project.
>
> Every future module MUST follow this document.
>
> No module may redefine architecture decisions made here.
>
> The objective is to build a production-ready, enterprise-grade Discord Bot capable of supporting thousands of Discord servers while remaining modular, maintainable and scalable.

---

# Primary Goals

The project must be:

* Modular
* Highly scalable
* Easy to maintain
* Easy to extend
* Multi-guild
* Multi-language
* Production ready
* Fully documented
* Testable
* Event-driven
* Secure
* Plugin-based

This project is expected to grow continuously for years.

The architecture must be designed with long-term maintainability in mind.

---

# Technology Stack

The project MUST use:

* Node.js LTS
* TypeScript (strict mode)
* NestJS
* Necord
* Prisma ORM
* MySQL
* Redis
* BullMQ
* Docker
* Docker Compose
* GitHub Actions
* Swagger/OpenAPI
* Pino Logger
* Zod
* ESLint
* Prettier
* Husky
* Commitlint
* Vitest
* Playwright (Dashboard)
* Prometheus
* Grafana
* OpenTelemetry

Only add new dependencies when there is a strong architectural reason.

Avoid unnecessary libraries.

---

# Architecture

The architecture must follow:

* Clean Architecture
* DDD Lite
* SOLID
* Dependency Injection
* Repository Pattern
* Event Driven Architecture

CQRS should only be used where it provides real benefits.

Do not over-engineer simple features.

---

# Project Layers

Every feature must respect this flow:

Controller

↓

Application Service

↓

Domain Service (when needed)

↓

Repository

↓

Database

Controllers MUST NEVER access Prisma directly.

Repositories are the only layer allowed to interact with Prisma.

---

# Folder Structure

The project should be organised by modules.

Example:

src/

core/

modules/

shared/

config/

database/

events/

plugins/

jobs/

api/

dashboard/

tests/

Each module must remain independent.

---

# Module Rules

Each module must contain:

* Controllers
* Services
* Repositories
* DTOs
* Entities
* Events
* Interfaces
* Validators
* Tests
* Documentation

Every module should expose only a public API.

Internal implementations must remain private.

---

# Plugin System

The bot must support plugins.

Plugins must be installable without modifying the core application.

Each plugin should have:

* Manifest
* Version
* Dependencies
* Permissions
* Configuration
* Lifecycle Hooks

Plugins should support:

* Install
* Enable
* Disable
* Update
* Remove

---

# Event Bus

Modules MUST communicate using events.

Avoid direct dependencies.

Good:

Module A

↓

Event Bus

↓

Module B

Bad:

Module A

↓

Module B Service

---

# Configuration

The bot must support configuration from:

* Environment variables
* Database
* Dashboard

Priority:

Environment

↓

Database

↓

Default Values

Every setting should support validation.

---

# Multi-Guild Support

Everything must be guild-aware.

Every configuration must belong to a guild unless explicitly global.

Nothing should assume a single Discord server.

---

# Translation System

The bot must include a complete translation system.

Requirements:

* Unlimited languages
* Dynamic loading
* Namespace support
* Variable replacement
* Plural support
* Dashboard editing
* Missing translation detection

Primary language:

Portuguese

Secondary language:

English

Architecture must support additional languages.

---

# Permissions System

Support:

Discord Permissions

Discord Roles

Bot Roles

Custom Permissions

Permission Groups

Permission Inheritance

Wildcard Permissions

Examples:

admin.*

tickets.close

tickets.*

games.*

fivem.restart

Permissions must be configurable.

---

# Logging

Everything should be logged.

Support:

Application Logs

Discord Logs

Database Logs

Security Logs

Audit Logs

Error Logs

Performance Logs

Logs should support multiple outputs.

---

# Cache

Implement a dedicated cache layer.

Support:

Memory Cache

Redis

Automatic invalidation

TTL

Namespaced keys

No module should directly manipulate Redis.

---

# Queue System

BullMQ should handle:

Scheduled Jobs

Delayed Jobs

Background Processing

Retries

Dead Letter Queue

Recurring Jobs

---

# Dashboard

A dedicated dashboard will exist.

Responsibilities:

Authentication

Guild Management

Configuration

Logs

Analytics

Module Management

Permissions

Translations

Plugin Management

API Keys

Backups

---

# API

Expose a REST API.

Future support:

WebSocket

GraphQL (optional)

Swagger documentation is mandatory.

---

# Security

Implement:

Rate Limiting

Cooldowns

Secret Management

Encryption

Audit Trail

Input Validation

Permission Validation

Sanitisation

Never trust user input.

---

# Database

Use Prisma.

Requirements:

Migrations

Seeders

Indexes

Transactions

Soft Deletes where appropriate

Repositories should encapsulate all database access.

---

# Monitoring

Support:

Health Checks

Metrics

Tracing

Performance Monitoring

Prometheus Exporter

Grafana Dashboards

OpenTelemetry

---

# Error Handling

Use a unified error system.

Every exception must be:

Logged

Categorised

Traceable

User Friendly

Unexpected errors should never expose internal information.

---

# Testing

Every module should include:

Unit Tests

Integration Tests

End-to-End Tests where appropriate

No feature is considered complete without tests.

---

# Documentation

Every module must include documentation.

Documentation should explain:

Purpose

Architecture

Configuration

Permissions

Events

Database Changes

Public APIs

Limitations

Examples

---

# Git Workflow

Branches:

main

develop

feature/<module>

bugfix/<issue>

hotfix/<issue>

release/<version>

Workflow:

Feature

↓

Pull Request

↓

Review

↓

Develop

↓

Release

↓

Main

No direct commits to main.

---

# Commit Convention

Use Conventional Commits.

Examples:

feat:

fix:

refactor:

docs:

test:

perf:

build:

ci:

---

# Coding Standards

Use strict TypeScript.

No any.

Prefer interfaces.

Prefer composition over inheritance.

Avoid duplicated logic.

Write self-documenting code.

Keep methods small.

Keep classes focused.

Never bypass architecture rules.

---

# Performance

Optimise for scalability.

Avoid unnecessary database queries.

Use caching responsibly.

Support pagination.

Support batching.

Support lazy loading where appropriate.

---

# Extensibility

Every system should be designed assuming future expansion.

Nothing should require rewriting the core.

Adding a new module should require minimal effort.

---

# Development Principles

Always prioritise:

Maintainability

Readability

Consistency

Scalability

Testability

Security

Developer Experience

Avoid shortcuts that create long-term technical debt.

---

# AI Development Rules

When generating code, always:

Follow this architecture.

Respect existing abstractions.

Avoid duplicated code.

Write production-ready implementations.

Generate documentation.

Generate tests.

Avoid placeholder implementations.

Avoid TODO comments unless explicitly requested.

Never modify unrelated modules.

Never introduce breaking changes without documenting them.

Always explain architectural decisions when introducing new patterns.

Every generated feature must be ready to be merged into production after review.

---

# Project Philosophy

The goal is not to create "another Discord bot".

The goal is to build a platform.

Every decision should favour long-term maintainability, modularity and professional software engineering practices over short-term convenience.
