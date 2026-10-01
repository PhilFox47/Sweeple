import { useEffect, useState } from "react";
import { api, type Player, type Round } from "../api";
import Import from "./Import";
import Avatar from "../components/Avatar";
import { IconCamera } from "../components/icons";
import ManageLibrary from "../components/ManageLibrary";
import { toSquareDataUrl } from "../utils/image";
import SummaryControl from "../components/SummaryControl";
import SyncControl from "../components/SyncControl";

export default function Settings({
  round,
  refreshToken,
  syncSignal,
  syncProgress,
  onChanged,
}: {
  round: Round | null;
  refreshToken: number;
  syncSignal: number;
  syncProgress: string | null;
  onChanged: () => void;
}) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [newProfile, setNewProfile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadPlayers() {
    try {
      const { users } = await api.listUsers();
      setPlayers(users);
      // Default the next round to whoever is already playing, else both admins.
      setSelected((prev) =>
        prev.length > 0
          ? prev.filter((id) => users.some((u) => u.id === id))
          : round
            ? round.players.map((p) => p.id)
            : users.filter((u) => u.isAdmin).map((u) => u.id)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile konnten nicht geladen werden");
    }
  }

  useEffect(() => {
    loadPlayers();
  }, [refreshToken]);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      onChanged();
      await loadPlayers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Da ist etwas schiefgegangen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-page">
      <section className="panel">
        <h3>Runde</h3>
        {round ? (
          <p className="panel-hint">
            Läuft mit <strong>{round.playerCount}</strong>{" "}
            {round.playerCount === 1 ? "Person" : "Personen"}: {round.players.map((p) => p.displayName).join(", ")}.
            Im Stapel landen nur Spiele, die zu {round.playerCount} gehen.
          </p>
        ) : (
          <p className="panel-hint">Keine Runde aktiv. Wähle aus, wer mitspielt, und starte eine.</p>
        )}

        <p className="field-label">Wer spielt mit?</p>
        <div className="chip-list">
          {players.map((p) => (
            <button
              key={p.id}
              className={`chip ${selected.includes(p.id) ? "chip-active" : ""}`}
              onClick={() => toggle(p.id)}
            >
              {p.displayName}
              {!p.isAdmin && <span className="chip-tag">Gast</span>}
            </button>
          ))}
        </div>

        <div className="row-actions">
          <button
            className="btn btn-primary"
            disabled={busy || selected.length === 0}
            onClick={() =>
              run(async () => {
                const { round: started } = await api.startRound(selected);
                return `Neue Runde mit ${started.playerCount} ${
                  started.playerCount === 1 ? "Person" : "Personen"
                } gestartet. Die bisherigen Swipes sind gelöscht.`;
              })
            }
          >
            Neue Runde starten
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || !round}
            onClick={() =>
              run(async () => {
                const r = await api.resetRound();
                return `Runde zurückgesetzt — ${r.swipes} Swipes und ${r.matches} offene Matches gelöscht.`;
              })
            }
          >
            Runde zurücksetzen
          </button>
        </div>
        <p className="panel-hint">
          Starten oder Zurücksetzen löscht alle Swipes, damit ihr frisch anfangt. Was ihr schon
          als gespielt markiert habt, bleibt erhalten.
        </p>
      </section>

      <section className="panel">
        <h3>Profile</h3>
        <p className="panel-hint">
          Wer mitswipet, braucht ein Profil — darüber werden die Stimmen gezählt. Profile bleiben
          erhalten, wer wiederkommt, behält also seine Statistik. Gäste können swipen, aber keine
          Einstellungen ändern. Ein Foto erscheint auf dem Anmeldebildschirm.
        </p>
        <div className="inline-form">
          <input
            type="text"
            placeholder="Name"
            value={newProfile}
            onChange={(e) => setNewProfile(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newProfile.trim()) {
                run(async () => {
                  const p = await api.addProfile(newProfile.trim());
                  setNewProfile("");
                  return `${p.displayName} hinzugefügt.`;
                });
              }
            }}
          />
          <button
            className="btn btn-primary"
            disabled={busy || !newProfile.trim()}
            onClick={() =>
              run(async () => {
                const p = await api.addProfile(newProfile.trim());
                setNewProfile("");
                return `${p.displayName} hinzugefügt.`;
              })
            }
          >
            Hinzufügen
          </button>
        </div>
        <div className="list-rows">
          {players.map((p) => (
            <div className="list-row" key={p.id}>
              <span className="list-row-main">
                <Avatar name={p.displayName} src={p.avatar} isAdmin={p.isAdmin} />
                {p.displayName} {p.isAdmin && <span className="chip-tag">Admin</span>}
              </span>
              <span className="row-buttons">
                {/* A hidden file input behind a label is the only way to style the picker. */}
                <label className={`btn btn-quiet photo-button ${busy ? "is-busy" : ""}`}>
                  <IconCamera />
                  {p.avatar ? "Ändern" : "Foto"}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      run(async () => {
                        await api.setAvatar(p.id, await toSquareDataUrl(file));
                        return `Foto von ${p.displayName} aktualisiert.`;
                      });
                    }}
                  />
                </label>
                {p.avatar && (
                  <button
                    className="btn btn-quiet"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.removeAvatar(p.id);
                        return `Foto von ${p.displayName} entfernt.`;
                      })
                    }
                  >
                    Entfernen
                  </button>
                )}
                {!p.isAdmin && (
                  <button
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.removeProfile(p.id);
                        return `${p.displayName} entfernt.`;
                      })
                    }
                  >
                    Löschen
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      <ManageLibrary refreshToken={refreshToken} />

      <SummaryControl refreshToken={refreshToken} />

      <section className="panel">
        <h3>BoardGameGeek</h3>
        <SyncControl syncSignal={syncSignal} progress={syncProgress} />
      </section>

      {notice && <div className="form-ok">{notice}</div>}
      {error && <div className="form-error">{error}</div>}

      <Import refreshToken={refreshToken} onImported={onChanged} />
    </div>
  );
}
