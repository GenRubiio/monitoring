# Specification: electron-system-monitor

## Overview

An Electron floating desktop application for real-time system monitoring of local and remote servers via SSH.

## Functional Requirements

### 1. Local System Metrics Display
- Display CPU usage percentage (real-time, updated every 2 seconds)
- Display RAM usage (used/total in MB)
- Display system temperature (CPU temperature if available)
- Minimal, clean UI with system tray integration
- Float above all other windows (always on top)

### 2. SSH Server Profile Management
- Configuration panel accessible from main UI
- Fields: Profile name, host, port, username, password
- Save/load profiles from persistent storage
- List of saved profiles with edit/delete options
- Test SSH connectivity before saving

### 3. Remote Metrics Collection
- Fetch CPU usage from remote servers via SSH
- Fetch RAM usage from remote servers via SSH
- Fetch temperature from remote servers (if available)
- Display remote metrics in main dashboard
- Profile selector dropdown to switch between local and remote views

### 4. Data Display and Updates
- Real-time metric updates (2-second interval)
- Error handling for SSH connection failures
- Display connection status for each remote profile
- Graceful degradation if metrics unavailable

## Acceptance Criteria

### AC1: Local Metrics Display
Given a running application on a system with CPU and RAM
When the app starts
Then it shall display current CPU and RAM usage within 2 seconds
And metrics shall update every 2 seconds
And UI shall remain responsive

### AC2: SSH Profile Configuration
Given the configuration panel is open
When user enters host (192.168.100.56), port (22), username (ubuntu), password (ubuntu)
And clicks "Test Connection"
Then the app shall verify SSH connectivity
And display a success or error message within 5 seconds

### AC3: Remote Metrics Collection
Given a valid SSH profile is configured and tested
When user selects it from the profile dropdown
Then the app shall fetch and display CPU, RAM, and temperature from remote system
And update metrics every 2 seconds
And display connection status as "Connected" or "Disconnected"

### AC4: Error Handling
Given SSH connection fails or metrics collection fails
Then the app shall display an error state for that profile
And continue operating for other profiles
And allow retry without restarting

### AC5: Persistent Configuration
Given user configures SSH profiles
When application restarts
Then all profiles shall be restored
And last used profile shall be remembered

## Technical Design Decisions

### Architecture
- Single-window Electron app with floating behavior
- React for UI components
- TypeScript for type safety
- Node.js native modules for system metrics

### Metrics Collection
- Local: Use `os` module and native bindings for detailed metrics
- Remote: SSH shell commands (cat /proc/cpuinfo, free, etc.)

### Storage
- Local filesystem (JSON file) for profile storage
- No encryption for MVP (plain text storage)

### Error Handling
- Graceful fallbacks for unavailable metrics
- Connection retry logic with exponential backoff
- User-friendly error messages

## Testing Strategy

### Unit Tests
- Metrics parsing from system output
- Profile validation logic
- SSH command generation

### Integration Tests
- SSH connection and command execution
- End-to-end metric collection flow
- Profile persistence

### E2E Tests
- Full user flow: configure profile, view metrics, switch profiles
- Error recovery scenarios

## Dependencies

- electron: ^latest
- react: ^18.0.0
- typescript: ^5.0.0
- ssh2: ^1.x (SSH client library)
- systeminformation: ^5.x (system metrics)

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| SSH connection timeout during metric fetch | Implement configurable timeout (default 5s) and connection pooling |
| Credentials exposed in plaintext | Document as MVP limitation; add encryption in Phase 2 |
| High CPU usage from frequent updates | Optimize update interval, implement debouncing |
| SSH library compatibility | Use well-maintained ssh2 library with broad platform support |

## Success Metrics

- App launches within 2 seconds
- Metrics update with < 500ms latency
- SSH connection established within 5 seconds
- Zero memory leaks after 1 hour of operation
- All acceptance criteria passing with test coverage > 70%
