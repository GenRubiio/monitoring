# electron-system-monitor Change

## Quick Reference

**Change ID**: electron-system-monitor  
**Status**: Initialized - Proposal and Specification complete  
**Next Phase**: Design  
**Created**: 2026-06-12

## What is this?

An Electron floating desktop app that monitors system metrics (CPU, RAM, temperature) locally and remotely via SSH profiles.

## Key Files

- **proposal.md** - Problem statement, solution overview, and scope
- **spec.md** - Detailed functional requirements and acceptance criteria
- **context.md** - Change metadata, current SDD configuration, phase status

## Quick Facts

- **Technology**: Electron + React + TypeScript
- **Test Server**: 192.168.100.56 (Ubuntu 22.04, credentials: ubuntu/ubuntu)
- **Update Interval**: 2 seconds for real-time metrics
- **MVP Scope**: Local metrics, SSH profiles, remote monitoring (no encryption)

## Acceptance Criteria

The change is successful when:

1. Local metrics (CPU, RAM) display and update every 2 seconds
2. SSH profiles can be configured and tested (target: 192.168.100.56)
3. Remote metrics are fetched and displayed for selected profiles
4. Connection status is clear and errors are handled gracefully
5. Configuration persists across application restarts

## Current Configuration

### SDD Status
- strict_tdd: false (will enable after test framework setup)
- Rules: All proposal/spec/design rules enforced
- Testing: Not yet configured (framework TBD)

### Project Context
- No existing test runner detected
- Recommend: Jest (unit) + Playwright (E2E)
- Will update config.yaml once testing infrastructure is selected

## Development Checklist

- [x] Proposal written and reviewed
- [x] Specification with acceptance criteria complete
- [ ] Design phase with tradeoffs and architecture
- [ ] Testing infrastructure setup
- [ ] Component development
- [ ] SSH integration and testing
- [ ] E2E testing with target server
- [ ] Code review and acceptance testing

## Environment

- **Directory**: /Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/openspec/changes/electron-system-monitor/
- **Config**: /Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/openspec/config.yaml
- **Project Root**: /Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/

## Next Steps

1. Read spec.md for detailed requirements
2. Enter DESIGN phase with architecture and component diagrams
3. Plan testing infrastructure (Jest + Playwright recommended)
4. Create task breakdown for APPLY phase
5. Begin component development

---

For detailed information, see the individual phase documents (proposal.md, spec.md, context.md).
