import React, { useEffect, useState } from 'react';
import type { SshProfile, SshProfileInput } from '../../shared/types';
import { WindowControls } from './WindowControls';

interface SSHPanelProps {
  onClose: () => void;
}

interface FormState {
  id?: string;
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
}

const EMPTY_FORM: FormState = {
  id: undefined,
  name: '',
  host: '',
  port: '22',
  username: '',
  password: '',
};

// Full SSH profile CRUD form. All elements are no-drag.
export function SSHPanel({ onClose }: SSHPanelProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [testResult, setTestResult] = useState<string | null>(null);

  const refresh = (): void => {
    void window.api.listProfiles().then(setProfiles);
  };

  useEffect(() => {
    refresh();
  }, []);

  const toInput = (): SshProfileInput => {
    const portNum = Number.parseInt(form.port, 10);
    return {
      id: form.id,
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number.isNaN(portNum) ? undefined : portNum,
      username: form.username.trim(),
      password: form.password,
    };
  };

  const handleField =
    (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

  const handleSave = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setTestResult(null);
    try {
      await window.api.saveProfile(toInput());
      setForm(EMPTY_FORM);
      refresh();
    } catch (err) {
      setTestResult(`Save failed: ${String(err)}`);
    }
  };

  const handleEdit = (profile: SshProfile): void => {
    setForm({
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: String(profile.port),
      username: profile.username,
      password: profile.password,
    });
    setTestResult(null);
  };

  const handleDelete = async (id: string): Promise<void> => {
    await window.api.deleteProfile(id);
    if (form.id === id) setForm(EMPTY_FORM);
    refresh();
  };

  const handleTest = async (): Promise<void> => {
    setTestResult('Testing…');
    const result = await window.api.testConnection(toInput());
    setTestResult(
      result.ok ? 'Connection OK' : `Connection failed: ${result.error ?? 'unknown error'}`,
    );
  };

  return (
    <div className="panel no-drag">
      <header className="panel__header">
        <h2>SSH Profiles</h2>
        <div className="panel__header-actions">
          <button type="button" className="no-drag" onClick={onClose}>
            Back
          </button>
          <WindowControls />
        </div>
      </header>

      <ul className="panel__list">
        {profiles.map((p) => (
          <li key={p.id} className="panel__list-item">
            <span>
              {p.name} ({p.username}@{p.host}:{p.port})
            </span>
            <span className="panel__list-actions">
              <button type="button" onClick={() => handleEdit(p)}>
                Edit
              </button>
              <button type="button" onClick={() => void handleDelete(p.id)}>
                Delete
              </button>
            </span>
          </li>
        ))}
        {profiles.length === 0 ? (
          <li className="panel__empty">No profiles yet.</li>
        ) : null}
      </ul>

      <form className="panel__form" onSubmit={(e) => void handleSave(e)}>
        <input
          placeholder="Name"
          value={form.name}
          onChange={handleField('name')}
          required
        />
        <input
          placeholder="Host"
          value={form.host}
          onChange={handleField('host')}
          required
        />
        <input
          placeholder="Port"
          value={form.port}
          onChange={handleField('port')}
          inputMode="numeric"
        />
        <input
          placeholder="Username"
          value={form.username}
          onChange={handleField('username')}
          required
        />
        <input
          placeholder="Password"
          type="password"
          value={form.password}
          onChange={handleField('password')}
          required
        />
        <div className="panel__form-actions">
          <button type="button" onClick={() => void handleTest()}>
            Test connection
          </button>
          <button type="submit">{form.id ? 'Update' : 'Save'}</button>
          {form.id ? (
            <button type="button" onClick={() => setForm(EMPTY_FORM)}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      {testResult ? <div className="panel__result">{testResult}</div> : null}
    </div>
  );
}
