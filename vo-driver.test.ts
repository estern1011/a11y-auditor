import { describe, test, expect } from "bun:test";
import { parseVoResponse, ROLE_PATTERN, COMMANDS, KEY_CODES, VALID_MODIFIERS } from "./vo-core.ts";
import { translateError, type ErrorContext } from "./vo-errors.ts";
import { getFlag } from "./vo-driver.ts";

// ---------------------------------------------------------------------------
// parseVoResponse
// ---------------------------------------------------------------------------

describe("parseVoResponse", () => {
  test("extracts heading level role", () => {
    const r = parseVoResponse("Example Domain heading level 1", "Example Domain heading level 1");
    expect(r.name).toBe("Example Domain");
    expect(r.role).toBe("heading level 1");
  });

  test("extracts link role", () => {
    const r = parseVoResponse("More info link", "More info link");
    expect(r.name).toBe("More info");
    expect(r.role).toBe("link");
  });

  test("extracts button role", () => {
    const r = parseVoResponse("Submit button", "Submit button");
    expect(r.name).toBe("Submit");
    expect(r.role).toBe("button");
  });

  test("extracts text field role", () => {
    const r = parseVoResponse("Email search text field", "Email search text field");
    expect(r.name).toBe("Email");
    expect(r.role).toBe("search text field");
  });

  test("extracts checkbox role", () => {
    const r = parseVoResponse("Accept terms checkbox", "Accept terms checkbox");
    expect(r.name).toBe("Accept terms");
    expect(r.role).toBe("checkbox");
  });

  test("extracts image role", () => {
    const r = parseVoResponse("Logo image", "Logo image");
    expect(r.name).toBe("Logo");
    expect(r.role).toBe("image");
  });

  test("handles empty strings", () => {
    const r = parseVoResponse("", "");
    expect(r.name).toBe("");
    expect(r.role).toBe("");
    expect(r.spoken).toBe("");
  });

  test("preserves spoken separately from itemText", () => {
    const r = parseVoResponse("spoken phrase", "Name button");
    expect(r.spoken).toBe("spoken phrase");
    expect(r.name).toBe("Name");
    expect(r.role).toBe("button");
  });

  test("returns full text when no role matches", () => {
    const r = parseVoResponse("just some text", "just some text");
    expect(r.name).toBe("just some text");
    expect(r.role).toBe("");
  });

  test("handles heading levels 2-6", () => {
    for (const level of [2, 3, 4, 5, 6]) {
      const text = `Section heading level ${level}`;
      const r = parseVoResponse(text, text);
      expect(r.name).toBe("Section");
      expect(r.role).toBe(`heading level ${level}`);
    }
  });

  test("extracts web content role", () => {
    const r = parseVoResponse("main web content", "main web content");
    expect(r.name).toBe("main");
    expect(r.role).toBe("web content");
  });

  test("extracts pop up button role", () => {
    const r = parseVoResponse("Sort by pop up button", "Sort by pop up button");
    expect(r.name).toBe("Sort by");
    expect(r.role).toBe("pop up button");
  });

  test("extracts radio button role", () => {
    const r = parseVoResponse("Option A radio button", "Option A radio button");
    expect(r.name).toBe("Option A");
    expect(r.role).toBe("radio button");
  });

  test("extracts dialog role", () => {
    const r = parseVoResponse("Confirm dialog", "Confirm dialog");
    expect(r.name).toBe("Confirm");
    expect(r.role).toBe("dialog");
  });
});

// ---------------------------------------------------------------------------
// COMMANDS catalog
// ---------------------------------------------------------------------------

describe("COMMANDS", () => {
  test("all entries have valid type", () => {
    for (const [key, entry] of Object.entries(COMMANDS)) {
      expect(["keyboard", "commander"]).toContain(entry.type);
    }
  });

  test("all entries have non-empty name", () => {
    for (const [key, entry] of Object.entries(COMMANDS)) {
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  test("no duplicate names within same type", () => {
    const seen = new Map<string, string>();
    for (const [key, entry] of Object.entries(COMMANDS)) {
      const id = `${entry.type}:${entry.name}`;
      if (seen.has(id)) {
        throw new Error(`Duplicate: ${key} and ${seen.get(id)} both map to ${id}`);
      }
      seen.set(id, key);
    }
  });

  test("contains essential navigation commands", () => {
    expect(COMMANDS.FIND_NEXT_HEADING).toBeDefined();
    expect(COMMANDS.FIND_NEXT_LINK).toBeDefined();
    expect(COMMANDS.FIND_NEXT_BUTTON).toBeDefined();
    expect(COMMANDS.GO_TO_BEGINNING).toBeDefined();
    expect(COMMANDS.START_INTERACTING).toBeDefined();
    expect(COMMANDS.STOP_INTERACTING).toBeDefined();
  });

  test("contains reading commands", () => {
    expect(COMMANDS.READ_CURRENT_ITEM).toBeDefined();
    expect(COMMANDS.READ_ALL).toBeDefined();
    expect(COMMANDS.READ_PAGE_STATS).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// translateError
// ---------------------------------------------------------------------------

describe("translateError", () => {
  test("translates movement errors", () => {
    const r = translateError(new Error("unable to move cursor"));
    expect(r.error).toContain("could not move");
    expect(r.suggestion).toContain("enter");
  });

  test("translates timeout errors", () => {
    const r = translateError(new Error("AppleScript timeout waiting for VO"));
    expect(r.error).toContain("not responding");
    expect(r.suggestion).toContain("kill");
  });

  test("translates unknown command with context", () => {
    const r = translateError(new Error("Unknown command: FAKE"), { command: "FAKE" });
    expect(r.error).toContain("FAKE");
    expect(r.suggestion).toContain("commands");
  });

  test("translates no page error", () => {
    const r = translateError(new Error("No page open"));
    expect(r.error).toContain("No browser page");
    expect(r.suggestion).toContain("start");
  });

  test("translates web content not found", () => {
    const r = translateError(new Error("Could not find web content area"));
    expect(r.error).toContain("web content");
    expect(r.suggestion).toContain("enter");
  });

  test("translates VoiceOver not running", () => {
    const r = translateError(new Error("VoiceOver not running"));
    expect(r.error).toContain("not running");
    expect(r.suggestion).toContain("kill");
  });

  test("translates unknown modifier with key context", () => {
    const r = translateError(new Error("Unknown modifier for key"), { key: "Tab" });
    expect(r.error).toContain("Tab");
    expect(r.suggestion).toContain("modifier");
  });

  test("falls back for unrecognized errors", () => {
    const r = translateError(new Error("something completely unknown"));
    expect(r.error).toBe("something completely unknown");
    expect(r.suggestion).toContain("kill");
  });

  test("handles non-Error values", () => {
    const r = translateError("string error");
    expect(r.error).toBe("string error");
  });
});

// ---------------------------------------------------------------------------
// getFlag
// ---------------------------------------------------------------------------

describe("getFlag", () => {
  test("returns fallback when flag absent", () => {
    expect(getFlag(["start", "https://example.com"], "port", 7483)).toBe(7483);
  });

  test("parses integer value", () => {
    expect(getFlag(["--port", "8080", "start"], "port", 7483)).toBe(8080);
  });

  test("returns fallback when flag has no value", () => {
    expect(getFlag(["--port"], "port", 7483)).toBe(7483);
  });

  test("handles cdp-port flag", () => {
    expect(getFlag(["--cdp-port", "9333", "start"], "cdp-port", 9222)).toBe(9333);
  });
});

// ---------------------------------------------------------------------------
// KEY_CODES and VALID_MODIFIERS
// ---------------------------------------------------------------------------

describe("KEY_CODES", () => {
  test("contains standard keys", () => {
    expect(KEY_CODES.Return).toBe(36);
    expect(KEY_CODES.Tab).toBe(48);
    expect(KEY_CODES.Escape).toBe(53);
    expect(KEY_CODES.Space).toBe(49);
  });

  test("arrow keys are defined", () => {
    expect(KEY_CODES.Left).toBeDefined();
    expect(KEY_CODES.Right).toBeDefined();
    expect(KEY_CODES.Up).toBeDefined();
    expect(KEY_CODES.Down).toBeDefined();
  });
});

describe("VALID_MODIFIERS", () => {
  test("has all four standard modifiers", () => {
    expect(Object.keys(VALID_MODIFIERS)).toEqual(["control", "option", "command", "shift"]);
  });

  test("values are AppleScript key down syntax", () => {
    for (const val of Object.values(VALID_MODIFIERS)) {
      expect(val).toMatch(/ down$/);
    }
  });
});
