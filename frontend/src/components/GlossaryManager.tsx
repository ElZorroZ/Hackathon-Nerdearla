import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import { Icon } from "./Icon";

export function GlossaryManager() {
  const [terms, setTerms] = useState<Record<string, string>>({});
  const [newOriginal, setNewOriginal] = useState("");
  const [newTranslation, setNewTranslation] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const load = useCallback(() => {
    api.getGlossary().then((data) => setTerms(data.terms || {}));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!newOriginal.trim() || !newTranslation.trim()) return;
    await api.addTerm(newOriginal.trim(), newTranslation.trim());
    setNewOriginal("");
    setNewTranslation("");
    load();
  };

  const handleDelete = async (original: string) => {
    await api.deleteTerm(original);
    load();
  };

  const handleUpdate = async (original: string) => {
    await api.updateTerm(original, editValue);
    setEditing(null);
    load();
  };

  const termEntries = Object.entries(terms);

  return (
    <div className="bg-[#11111e] border border-gray-800/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="book" className="w-5 h-5 text-indigo-400" />
        <h2 className="text-sm font-semibold text-gray-200">
          Glosario Técnico
        </h2>
        <span className="text-xs text-gray-600">
          {termEntries.length} términos
        </span>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Término original"
          value={newOriginal}
          onChange={(e) => setNewOriginal(e.target.value)}
          className="flex-1 bg-[#0a0a14] text-gray-200 px-3 py-2 rounded-lg border border-gray-700 focus:border-indigo-500 outline-none text-sm"
        />
        <input
          type="text"
          placeholder="Traducción"
          value={newTranslation}
          onChange={(e) => setNewTranslation(e.target.value)}
          className="flex-1 bg-[#0a0a14] text-gray-200 px-3 py-2 rounded-lg border border-gray-700 focus:border-indigo-500 outline-none text-sm"
        />
        <button
          onClick={handleAdd}
          className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-sm transition-all"
        >
          <Icon name="plus" className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1 max-h-64 overflow-y-auto">
        {termEntries.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-4">
            No hay términos en el glosario
          </p>
        ) : (
          termEntries.map(([original, translation]) => (
            <div
              key={original}
              className="flex items-center gap-2 bg-[#0a0a14] rounded-lg px-3 py-2 group hover:bg-[#15152a] transition-colors"
            >
              {editing === original ? (
                <>
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 bg-[#1a1a2e] text-gray-200 px-2 py-1 rounded border border-indigo-500 outline-none text-sm"
                  />
                  <button
                    onClick={() => handleUpdate(original)}
                    className="text-green-400 hover:text-green-300 text-xs px-2"
                  >
                    OK
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="text-gray-500 hover:text-gray-400 text-xs px-2"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <span className="text-gray-400 text-sm flex-1">
                    {original}
                  </span>
                  <span className="text-gray-600">→</span>
                  <span className="text-gray-200 text-sm flex-1">
                    {translation}
                  </span>
                  <button
                    onClick={() => {
                      setEditing(original);
                      setEditValue(translation);
                    }}
                    className="text-gray-500 hover:text-indigo-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    editar
                  </button>
                  <button
                    onClick={() => handleDelete(original)}
                    className="text-gray-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Icon name="trash" className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
