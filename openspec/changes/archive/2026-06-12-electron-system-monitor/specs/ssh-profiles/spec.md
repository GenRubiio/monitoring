# SSH Profiles Specification

## Purpose

Define the behavior for managing SSH connection profiles and collecting system
metrics from a selected remote Linux server over SSH. This covers profile CRUD,
credential persistence (plain text in the MVP via `electron-store` v8), selection
of the active remote target, remote metric collection through a persistent SSH
connection, reconnection on connection loss, and graceful error handling.

## Requirements

### Requirement: SSH Profile Creation, Editing, and Deletion

The application MUST allow the user to create, edit, and delete named SSH
profiles. Each profile MUST include a host, a port (defaulting to 22 when not
specified), a username, and a password, plus a stable identifier. Profile
mutations MUST be handled in the main process via the `profile:save` (create or
update) and `profile:delete` IPC invoke channels. The list of stored profiles
MUST be retrievable via the `profile:list` invoke channel.

#### Scenario: Create a profile

- GIVEN the user opens the SSH profile panel
- WHEN the user enters host `192.168.100.56`, username `ubuntu`, and password `ubuntu`, and saves
- THEN the main process MUST persist a new profile with port defaulting to 22
- AND the profile MUST appear in the result of `profile:list`

#### Scenario: Edit a profile

- GIVEN an existing saved profile
- WHEN the user changes a field and saves
- THEN `profile:save` MUST update the existing profile in place by its identifier
- AND MUST NOT create a duplicate profile

#### Scenario: Delete a profile

- GIVEN an existing saved profile
- WHEN the user deletes it
- THEN `profile:delete` MUST remove that profile permanently
- AND the profile MUST NOT appear in subsequent `profile:list` results

### Requirement: Credential Persistence (Plain Text MVP)

The application MUST persist SSH profiles, including passwords, using
`electron-store` version 8 (CommonJS-compatible). The application MUST NOT
upgrade to `electron-store` v10 or later in the MVP, because those versions are
ESM-only and incompatible with the project's CommonJS module system. In the MVP,
credentials MUST be stored in plain text; this is an explicitly accepted gap, and
encryption via `safeStorage` is deferred to Phase 2. Stored profiles MUST persist
across application restarts.

#### Scenario: Profiles survive a restart

- GIVEN the user has saved one or more profiles
- WHEN the application is closed and reopened
- THEN all previously saved profiles MUST be present in `profile:list`

#### Scenario: CommonJS-compatible store version

- GIVEN the application persists profiles
- WHEN the storage dependency is resolved
- THEN it MUST use `electron-store` v8.x
- AND it MUST NOT use `electron-store` v10 or later in the MVP

### Requirement: Active Profile Selection

The application MUST allow the user to select exactly one active remote profile
at a time. Selection MUST be communicated to the main process over the
`profile:select` IPC channel. Selecting a profile MUST cause remote metric
polling to target that profile. The MVP MUST NOT poll more than one remote
profile simultaneously.

#### Scenario: Switching the active profile

- GIVEN at least one saved profile exists
- WHEN the user selects a profile as the active remote target
- THEN the main process MUST begin collecting remote metrics from that profile
- AND MUST stop collecting from any previously active profile

#### Scenario: Single active profile constraint

- GIVEN a profile is already active
- WHEN the user selects a different profile
- THEN only the newly selected profile MUST be polled
- AND no more than one remote profile MUST be polled at a time

### Requirement: Connection Test

The application MUST provide a way to test an SSH connection before or after
saving a profile, via the `ssh:test` invoke channel. The test MUST return a
success result when the connection succeeds, or an error string describing the
failure when it does not.

#### Scenario: Successful connection test

- GIVEN valid profile connection details
- WHEN the user triggers a connection test
- THEN `ssh:test` MUST return a success result

#### Scenario: Failed connection test

- GIVEN connection details that cannot authenticate or reach the host
- WHEN the user triggers a connection test
- THEN `ssh:test` MUST return an error result containing a descriptive error string
- AND the application MUST NOT crash

### Requirement: Remote Metric Collection

The application MUST collect CPU load percentage, RAM used/total, and CPU
temperature from the active remote profile over SSH, using a persistent `ssh2`
`Client` per active profile. The application MUST NOT open a new SSH connection
for each metric tick. Remote metrics MUST be collected on the same 2-second
interval as local metrics and pushed to the renderer over the `metrics:remote`
IPC channel. After selecting a remote profile, remote metrics SHOULD appear in
the widget within 5 seconds.

Remote metrics MUST be parsed from standard Linux commands (for example
`top`/`/proc/stat` for CPU, `free -b` for RAM). Remote CPU temperature MUST be
treated as optional: the application SHOULD read `sensors` when `lm-sensors` is
available and MUST fall back to `/sys/class/thermal/thermal_zone0/temp` when it
is not. If neither source yields a value, the widget MUST display "N/A".

#### Scenario: Remote metrics displayed for active profile

- GIVEN the user has selected a reachable remote profile (e.g. `192.168.100.56`)
- WHEN the connection is established
- THEN the widget MUST display remote CPU%, RAM used/total, and temperature (or "N/A")
- AND the remote metrics SHOULD appear within 5 seconds of selection

#### Scenario: Persistent connection reused across ticks

- GIVEN remote metrics are being polled
- WHEN consecutive 2-second polling ticks occur
- THEN the same persistent `ssh2` connection MUST be reused
- AND a new SSH connection MUST NOT be opened per tick

#### Scenario: Remote temperature falls back to thermal zone

- GIVEN the remote server does not have `lm-sensors` installed
- WHEN remote temperature is collected
- THEN the application MUST read `/sys/class/thermal/thermal_zone0/temp`
- AND if that also fails, the widget MUST display "N/A"

### Requirement: Reconnection With Backoff

When the SSH connection to the active profile drops (error or close event), the
application MUST automatically attempt to reconnect using exponential backoff
starting at 1 second and doubling (1 s, 2 s, 4 s, …) capped at 30 seconds. During
the reconnection gap, the renderer MUST show a "reconnecting" state. Metric
polling MUST resume automatically once the connection is restored, without user
interaction.

#### Scenario: Automatic reconnect after a drop

- GIVEN remote metrics are being polled over an active connection
- WHEN the SSH connection drops
- THEN the widget MUST show a "reconnecting" state
- AND the application MUST retry with exponential backoff (1 s, 2 s, 4 s, capped at 30 s)
- AND remote metric polling MUST resume automatically once reconnected

### Requirement: Stop Polling on Deletion of Active Profile

When the user deletes the currently active profile, the application MUST stop
remote metric polling and tear down its SSH connection. The widget MUST stop
displaying stale remote metrics for the deleted profile.

#### Scenario: Deleting the active profile stops polling

- GIVEN a profile is the active remote target and is being polled
- WHEN the user deletes that profile
- THEN remote metric polling MUST stop
- AND the SSH connection for that profile MUST be torn down
- AND the widget MUST NOT continue showing metrics for the deleted profile

### Requirement: IPC Validation and Security for Profile Operations

All SSH operations and profile persistence MUST run in the main process. The
renderer MUST access them only through the preload-exposed named API backed by
the `ssh:test`, `profile:save`, `profile:delete`, `profile:list`, and
`profile:select` channels. IPC handlers MUST validate their arguments before
acting on them. The application MUST preserve `contextIsolation: true`,
`nodeIntegration: false`, and `sandbox: true`, and MUST NOT expose the raw
`ipcRenderer` to the renderer.

#### Scenario: Invalid IPC arguments are rejected

- GIVEN an IPC handler for a profile operation
- WHEN it receives malformed or missing arguments
- THEN the handler MUST validate and reject the request
- AND MUST NOT crash the main process

#### Scenario: SSH logic stays in the main process

- GIVEN the renderer needs to test a connection or persist a profile
- WHEN it performs the operation
- THEN it MUST invoke the corresponding preload-exposed named function
- AND the actual SSH and storage work MUST execute in the main process
