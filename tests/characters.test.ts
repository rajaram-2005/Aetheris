import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

before(() => { process.env.AETHERIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-characters-")); });

test("curated character database has four traditions and complete dual-mode records", async () => {
  const { BUILT_IN_CHARACTERS, listCharacters } = await import("../src/lib/characters");
  const characters = await listCharacters("reader-1");
  assert.equal(characters.length, BUILT_IN_CHARACTERS.length);
  assert.ok(characters.length >= 16);
  assert.equal(new Set(characters.map((character) => character.id)).size, characters.length);
  assert.deepEqual(new Set(characters.map((character) => character.tradition)), new Set(["Hindu traditions", "Greek mythology", "Norse mythology", "Egyptian mythology"]));
  for (const character of characters) {
    assert.equal(character.builtIn, true);
    assert.deepEqual(character.modes, ["roleplay", "guide"]);
    assert.ok(character.description.length > 40, character.id);
    assert.ok(character.instructions.length > 100, character.id);
    assert.ok(character.suggestedPrompts.length >= 3, character.id);
    assert.ok(character.sourceNote, character.id);
  }
});

test("custom character CRUD is private and built-ins are immutable", async () => {
  const { createCharacter, deleteCharacter, getCharacter, listCharacters, updateCharacter } = await import("../src/lib/characters");
  const custom = await createCharacter("owner-a", {
    name: "  Kaveri Guide  ", avatar: "🌊", tradition: "Original", title: "River storyteller",
    description: "A patient guide", greeting: "Welcome", traits: "patient, observant, patient",
    instructions: "Tell grounded stories and clearly label invented details.", modes: ["guide"], suggestedPrompts: ["Tell me a story"],
  });
  assert.match(custom.id, /^char_/);
  assert.equal(custom.name, "Kaveri Guide");
  assert.deepEqual(custom.traits, ["patient", "observant"]);
  assert.deepEqual(custom.modes, ["guide"]);
  assert.equal((await getCharacter("owner-a", custom.id))?.id, custom.id);
  assert.equal(await getCharacter("other-user", custom.id), null);
  assert.ok((await listCharacters("owner-a")).some((character) => character.id === custom.id));
  assert.ok(!(await listCharacters("other-user")).some((character) => character.id === custom.id));

  assert.equal(await updateCharacter("other-user", custom.id, { name: "Stolen" }), null);
  const updated = await updateCharacter("owner-a", custom.id, { name: "Kaveri", modes: ["roleplay", "guide"] });
  assert.equal(updated?.name, "Kaveri");
  assert.deepEqual(updated?.modes, ["roleplay", "guide"]);

  assert.equal(await updateCharacter("owner-a", "hindu-shiva", { name: "Changed" }), null);
  assert.equal(await deleteCharacter("owner-a", "hindu-shiva"), false);
  assert.equal(await deleteCharacter("other-user", custom.id), false);
  assert.equal(await deleteCharacter("owner-a", custom.id), true);
  assert.equal(await getCharacter("owner-a", custom.id), null);
});

test("character prompts distinguish roleplay and guide while retaining safeguards", async () => {
  const { BUILT_IN_CHARACTERS, characterSystemPrompt, normalizeCharacterInput } = await import("../src/lib/characters");
  const shiva = BUILT_IN_CHARACTERS.find((character) => character.id === "hindu-shiva")!;
  const roleplay = characterSystemPrompt(shiva, "roleplay");
  const guide = characterSystemPrompt(shiva, "guide");
  assert.match(roleplay, /ROLEPLAY MODE.*first person/s);
  assert.match(guide, /GUIDE MODE.*source awareness/s);
  for (const prompt of [roleplay, guide]) {
    assert.match(prompt, /server-side character database/);
    assert.match(prompt, /Never issue "divine" commands/);
    assert.match(prompt, /Do not invent scripture/);
  }
  assert.throws(() => normalizeCharacterInput({ name: "No modes", modes: [] }), /select at least one mode/);
});
