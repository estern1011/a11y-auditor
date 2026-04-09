import { describe, test, expect } from "bun:test";
import { parseOrcaResponse, ORCA_COMMANDS } from "./orca-types.ts";
import { translateError, type ErrorContext } from "./orca-errors.ts";
import { getFlag } from "./orca-driver.ts";

// ---------------------------------------------------------------------------
// parseOrcaResponse
// ---------------------------------------------------------------------------

describe("parseOrcaResponse", () => {
  test("builds response from AT-SPI2 structured data", () => {
    const r = parseOrcaResponse("", "Example Domain", "heading", []);
    expect(r.name).toBe("Example Domain");
    expect(r.role).toBe("heading");
    expect(r.state).toEqual([]);
    expect(r.spoken).toBe("Example Domain, heading");
  });

  test("preserves explicit spoken text", () => {
    const r = parseOrcaResponse("custom announcement", "Button", "push button", []);
    expect(r.spoken).toBe("custom announcement");
    expect(r.name).toBe("Button");
    expect(r.role).toBe("push button");
  });

  test("includes state in spoken text", () => {
    const r = parseOrcaResponse("", "Accept terms", "check box", ["unchecked"]);
    expect(r.spoken).toBe("Accept terms, check box, unchecked");
    expect(r.state).toEqual(["unchecked"]);
  });

  test("handles multiple states", () => {
    const r = parseOrcaResponse("", "Email", "text", ["required", "invalid"]);
    expect(r.state).toEqual(["required", "invalid"]);
    expect(r.spoken).toBe("Email, text, required, invalid");
  });

  test("handles empty strings", () => {
    const r = parseOrcaResponse("", "", "", []);
    expect(r.name).toBe("");
    expect(r.role).toBe("");
    expect(r.spoken).toBe("");
    expect(r.state).toEqual([]);
  });

  test("handles name-only element", () => {
    const r = parseOrcaResponse("", "just some text", "", []);
    expect(r.name).toBe("just some text");
    expect(r.role).toBe("");
    expect(r.spoken).toBe("just some text");
  });

  test("handles checked checkbox", () => {
    const r = parseOrcaResponse("", "Remember me", "check box", ["checked"]);
    expect(r.name).toBe("Remember me");
    expect(r.role).toBe("check box");
    expect(r.state).toEqual(["checked"]);
  });

  test("handles expanded state", () => {
    const r = parseOrcaResponse("", "Menu", "push button", ["expanded", "has popup"]);
    expect(r.state).toEqual(["expanded", "has popup"]);
  });

  test("handles link with visited state", () => {
    const r = parseOrcaResponse("", "Home", "link", ["visited"]);
    expect(r.name).toBe("Home");
    expect(r.role).toBe("link");
    expect(r.state).toEqual(["visited"]);
  });
});

// ---------------------------------------------------------------------------
// ORCA_COMMANDS catalog
// ---------------------------------------------------------------------------

describe("ORCA_COMMANDS", () => {
  test("all entries have a key", () => {
    for (const [name, entry] of Object.entries(ORCA_COMMANDS)) {
      expect(entry.key.length).toBeGreaterThan(0);
    }
  });

  test("modifiers are arrays when present", () => {
    for (const [name, entry] of Object.entries(ORCA_COMMANDS)) {
      if (entry.modifiers !== undefined) {
        expect(Array.isArray(entry.modifiers)).toBe(true);
      }
    }
  });

  test("contains essential navigation commands", () => {
    expect(ORCA_COMMANDS.FIND_NEXT_HEADING).toBeDefined();
    expect(ORCA_COMMANDS.FIND_NEXT_LINK).toBeDefined();
    expect(ORCA_COMMANDS.FIND_NEXT_BUTTON).toBeDefined();
    expect(ORCA_COMMANDS.FIND_NEXT_LANDMARK).toBeDefined();
    expect(ORCA_COMMANDS.FIND_NEXT_IMAGE).toBeDefined();
    expect(ORCA_COMMANDS.FIND_NEXT_TABLE).toBeDefined();
    expect(ORCA_COMMANDS.GO_TO_BEGINNING).toBeDefined();
    expect(ORCA_COMMANDS.GO_TO_END).toBeDefined();
  });

  test("contains heading level commands", () => {
    for (let i = 1; i <= 6; i++) {
      expect(ORCA_COMMANDS[`FIND_NEXT_HEADING_${i}`]).toBeDefined();
      expect(ORCA_COMMANDS[`FIND_PREVIOUS_HEADING_${i}`]).toBeDefined();
    }
  });

  test("previous variants use shift modifier", () => {
    const prevCmds = Object.entries(ORCA_COMMANDS)
      .filter(([name]) => name.startsWith("FIND_PREVIOUS_"));
    expect(prevCmds.length).toBeGreaterThan(5);
    for (const [name, entry] of prevCmds) {
      expect(entry.modifiers).toContain("shift");
    }
  });

  test("contains form control commands", () => {
    expect(ORCA_COMMANDS.FIND_NEXT_CONTROL).toBeDefined();
    expect(ORCA_COMMANDS.FIND_NEXT_ENTRY).toBeDefined();
    expect(ORCA_COMMANDS.FIND_NEXT_CHECKBOX).toBeDefined();
    expect(ORCA_COMMANDS.FIND_NEXT_RADIO_BUTTON).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// translateError
// ---------------------------------------------------------------------------

describe("translateError", () => {
  test("translates AT-SPI2 not found", () => {
    const r = translateError(new Error("AT-SPI2 GObject bindings not found"));
    expect(r.error).toContain("AT-SPI2");
    expect(r.suggestion).toContain("apt install");
  });

  test("translates AT-SPI2 bus connection failure", () => {
    const r = translateError(new Error("Cannot connect to AT-SPI2 bus"));
    expect(r.error).toContain("accessibility bus");
    expect(r.suggestion).toContain("at-spi");
  });

  test("translates no focused element", () => {
    const r = translateError(new Error("No focused element found"));
    expect(r.error).toContain("focused");
    expect(r.suggestion).toContain("enter");
  });

  test("translates query timeout", () => {
    const r = translateError(new Error("AT-SPI2 query timeout"));
    expect(r.error).toContain("timed out");
    expect(r.suggestion).toContain("kill");
  });

  test("translates missing keyboard tool", () => {
    const r = translateError(new Error("No keyboard tool found. Install xdotool"));
    expect(r.error).toContain("keyboard");
    expect(r.suggestion).toContain("xdotool");
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

  test("translates unknown modifier", () => {
    const r = translateError(new Error("Unknown modifier for key"), { key: "Tab" });
    expect(r.error).toContain("Tab");
    expect(r.suggestion).toContain("modifier");
  });

  test("translates Orca not running", () => {
    const r = translateError(new Error("Orca not running"));
    expect(r.error).toContain("not running");
    expect(r.suggestion).toContain("kill");
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
    expect(getFlag(["start", "https://example.com"], "port", 7484)).toBe(7484);
  });

  test("parses integer value", () => {
    expect(getFlag(["--port", "8080", "start"], "port", 7484)).toBe(8080);
  });

  test("returns fallback when flag has no value", () => {
    expect(getFlag(["--port"], "port", 7484)).toBe(7484);
  });

  test("handles cdp-port flag", () => {
    expect(getFlag(["--cdp-port", "9333", "start"], "cdp-port", 9223)).toBe(9333);
  });
});
