/**
 * AT-SPI2 accessibility tree client via D-Bus.
 *
 * Replaces the Python orca-atspi.py helper. Communicates with AT-SPI2's
 * accessibility bus using the org.a11y.atspi.Accessible D-Bus interface.
 *
 * Architecture:
 *   Session bus → org.a11y.Bus.GetAddress() → AT-SPI2 bus → tree queries
 */

import dbus from "dbus-native";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccessibleElement {
  name: string;
  role: string;
  state: string[];
  app?: string;
}

// AT-SPI2 role enum → human-readable name (subset of common roles)
const ROLE_NAMES: Record<number, string> = {
  0: "invalid", 1: "accelerator label", 2: "alert", 3: "animation",
  4: "arrow", 5: "calendar", 6: "canvas", 7: "check box", 8: "check menu item",
  9: "color chooser", 10: "column header", 11: "combo box", 12: "date editor",
  13: "desktop icon", 14: "desktop frame", 15: "dial", 16: "dialog",
  17: "directory pane", 18: "drawing area", 19: "file chooser", 20: "filler",
  21: "focus traversable", 22: "font chooser", 23: "frame", 24: "glass pane",
  25: "html container", 26: "icon", 27: "image", 28: "internal frame",
  29: "label", 30: "layered pane", 31: "list", 32: "list item",
  33: "menu", 34: "menu bar", 35: "menu item", 36: "option pane",
  37: "page tab", 38: "page tab list", 39: "panel", 40: "password text",
  41: "popup menu", 42: "progress bar", 43: "push button", 44: "radio button",
  45: "radio menu item", 46: "root pane", 47: "row header", 48: "scroll bar",
  49: "scroll pane", 50: "separator", 51: "slider", 52: "spin button",
  53: "split pane", 54: "status bar", 55: "table", 56: "table cell",
  57: "table column header", 58: "table row header", 59: "tearoff menu item",
  60: "terminal", 61: "text", 62: "toggle button", 63: "tool bar",
  64: "tool tip", 65: "tree", 66: "tree table", 67: "unknown",
  68: "viewport", 69: "window", 70: "extended", 71: "header",
  72: "footer", 73: "paragraph", 74: "ruler", 75: "application",
  76: "autocomplete", 77: "editbar", 78: "embedded", 79: "entry",
  80: "chart", 81: "caption", 82: "document frame", 83: "heading",
  84: "page", 85: "section", 86: "redundant object", 87: "form",
  88: "link", 89: "input method window", 90: "table row", 91: "tree item",
  92: "document spreadsheet", 93: "document presentation", 94: "document text",
  95: "document web", 96: "document email", 97: "comment", 98: "list box",
  99: "grouping", 100: "image map", 101: "notification", 102: "info bar",
  103: "level bar", 104: "title bar", 105: "block quote", 106: "audio",
  107: "video", 108: "definition", 109: "article", 110: "landmark",
  111: "log", 112: "marquee", 113: "math", 114: "rating", 115: "timer",
  116: "static", 117: "math fraction", 118: "math root", 119: "subscript",
  120: "superscript", 121: "description list", 122: "description term",
  123: "description value", 124: "footnote", 125: "content deletion",
  126: "content insertion", 127: "mark", 128: "suggestion",
};

// AT-SPI2 state bit positions → human-readable
const STATE_NAMES: Record<number, string> = {
  0: "invalid", 1: "active", 2: "armed", 3: "busy",
  4: "checked", 5: "collapsed", 6: "defunct", 7: "editable",
  8: "enabled", 9: "expandable", 10: "expanded", 11: "focusable",
  12: "focused", 13: "has-tooltip", 14: "horizontal", 15: "iconified",
  16: "modal", 17: "multi-line", 18: "multiselectable", 19: "opaque",
  20: "pressed", 21: "resizable", 22: "selectable", 23: "selected",
  24: "sensitive", 25: "showing", 26: "single-line", 27: "stale",
  28: "transient", 29: "vertical", 30: "visible", 31: "manages-descendants",
  32: "indeterminate", 33: "required", 34: "truncated", 35: "animated",
  36: "invalid-entry", 37: "supports-autocompletion", 38: "selectable-text",
  39: "is-default", 40: "visited", 41: "checkable", 42: "has-popup",
  43: "read-only",
};

// ---------------------------------------------------------------------------
// D-Bus connection management
// ---------------------------------------------------------------------------

let a11yBus: any = null;

async function getA11yBusAddress(): Promise<string> {
  // Check environment first
  if (process.env.AT_SPI_BUS_ADDRESS) return process.env.AT_SPI_BUS_ADDRESS;

  // Query via D-Bus session bus → org.a11y.Bus → GetAddress()
  return new Promise((resolve, reject) => {
    const sessionBus = dbus.sessionBus();
    const msg = {
      destination: "org.a11y.Bus",
      path: "/org/a11y/bus",
      interface: "org.a11y.Bus",
      member: "GetAddress",
    };
    sessionBus.invoke(msg, (err: Error | null, result: any) => {
      if (err) {
        reject(new Error(`Cannot find AT-SPI2 bus address: ${err.message}`));
        return;
      }
      const addr = typeof result === "string" ? result : String(result);
      if (addr) {
        resolve(addr);
      } else {
        reject(new Error("AT-SPI2 bus address is empty"));
      }
    });
  });
}

async function getConnection(): Promise<any> {
  if (a11yBus) return a11yBus;

  const address = await getA11yBusAddress();
  a11yBus = dbus.createClient({
    busAddress: address,
  });
  return a11yBus;
}

/**
 * Close the D-Bus connection.
 */
export function disconnect(): void {
  if (a11yBus) {
    try { a11yBus.connection?.end(); } catch {}
    a11yBus = null;
  }
}

// ---------------------------------------------------------------------------
// Keyboard event injection via AT-SPI2
// ---------------------------------------------------------------------------

// AT-SPI2 KeySynthType enum
const KEY_PRESSRELEASE = 0;
const KEY_SYM = 2;

// X11 keysym values for common keys
const KEYSYM_MAP: Record<string, number> = {
  Return: 0xff0d, Enter: 0xff0d,
  space: 0x0020, Escape: 0xff1b, Tab: 0xff09,
  Left: 0xff51, Right: 0xff53, Down: 0xff54, Up: 0xff52,
  Delete: 0xffff, BackSpace: 0xff08,
  Home: 0xff50, End: 0xff57,
  Prior: 0xff55, Next: 0xff56, // PageUp, PageDown
  F1: 0xffbe, F2: 0xffbf, F3: 0xffc0, F4: 0xffc1,
  F5: 0xffc2, F6: 0xffc3, F7: 0xffc4, F8: 0xffc5,
  F9: 0xffc6, F10: 0xffc7, F11: 0xffc8, F12: 0xffc9,
  shift: 0xffe1, ctrl: 0xffe3, alt: 0xffe9, super: 0xffeb,
};

/**
 * Send a keyboard event through AT-SPI2's DeviceEventController.
 * Unlike xdotool (which uses XTEST), this goes through the AT-SPI2
 * D-Bus pipeline, so Orca actually sees and responds to the keystroke.
 */
export async function generateKeyboardEvent(key: string, modifiers: string[] = []): Promise<void> {
  const bus = await getConnection();
  const REGISTRY = "org.a11y.atspi.Registry";
  const DEC_PATH = "/org/a11y/atspi/registry/deviceeventcontroller";

  // Actual D-Bus signature: GenerateKeyboardEvent(keycode: int, keystring: string, type: uint)
  // type: 0=KEY_PRESS, 1=KEY_RELEASE, 2=KEY_PRESSRELEASE, 3=KEY_SYM

  // For single printable characters (like 'h' for heading quick-nav),
  // use the character's Unicode code point as the keysym
  let keysym = KEYSYM_MAP[key];
  if (keysym === undefined && key.length === 1) {
    keysym = key.charCodeAt(0);
  }
  if (keysym === undefined) {
    throw new Error(`Unknown key: ${key}. Not in keysym map.`);
  }

  // Press modifiers first (KEY_PRESS = 0)
  for (const mod of modifiers) {
    const modSym = KEYSYM_MAP[mod];
    if (modSym) {
      await callMethod(bus, REGISTRY, DEC_PATH,
        "org.a11y.atspi.DeviceEventController", "GenerateKeyboardEvent",
        "isu", [modSym, "", 0]
      ).catch(() => {});
    }
  }

  // Send the key press+release (KEY_PRESSRELEASE = 2)
  await callMethod(bus, REGISTRY, DEC_PATH,
    "org.a11y.atspi.DeviceEventController", "GenerateKeyboardEvent",
    "isu", [keysym, "", 2]
  );

  // Release modifiers in reverse (KEY_RELEASE = 1)
  for (const mod of [...modifiers].reverse()) {
    const modSym = KEYSYM_MAP[mod];
    if (modSym) {
      await callMethod(bus, REGISTRY, DEC_PATH,
        "org.a11y.atspi.DeviceEventController", "GenerateKeyboardEvent",
        "isu", [modSym, "", 1]
      ).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// D-Bus helpers
// ---------------------------------------------------------------------------

function callMethod(
  bus: any,
  dest: string,
  path: string,
  iface: string,
  method: string,
  signature?: string,
  body?: any[]
): Promise<any> {
  return new Promise((resolve, reject) => {
    const msg: any = {
      destination: dest,
      path,
      interface: iface,
      member: method,
    };
    if (signature) {
      msg.signature = signature;
      msg.body = body || [];
    }
    bus.invoke(msg, (err: Error | null, result: any) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function getProperty(
  bus: any,
  dest: string,
  path: string,
  iface: string,
  prop: string
): Promise<any> {
  return callMethod(
    bus, dest, path,
    "org.freedesktop.DBus.Properties", "Get",
    "ss", [iface, prop]
  );
}

// ---------------------------------------------------------------------------
// AT-SPI2 accessors
// ---------------------------------------------------------------------------

function parseStates(stateArray: number[]): string[] {
  // AT-SPI2 returns states as two uint32 values (bitmask)
  const states: string[] = [];
  if (!stateArray || stateArray.length < 2) return states;

  for (let word = 0; word < 2; word++) {
    for (let bit = 0; bit < 32; bit++) {
      if (stateArray[word] & (1 << bit)) {
        const idx = word * 32 + bit;
        const name = STATE_NAMES[idx];
        if (name && name !== "invalid") states.push(name);
      }
    }
  }
  return states;
}

async function getAccessibleName(bus: any, dest: string, path: string): Promise<string> {
  try {
    const result = await getProperty(bus, dest, path, "org.a11y.atspi.Accessible", "Name");
    return (result?.[1]?.[0] || "").toString();
  } catch {
    return "";
  }
}

async function getAccessibleRole(bus: any, dest: string, path: string): Promise<string> {
  try {
    const result = await callMethod(bus, dest, path, "org.a11y.atspi.Accessible", "GetRole");
    const roleNum = typeof result === "number" ? result : result?.[0] || 0;
    return ROLE_NAMES[roleNum] || `role-${roleNum}`;
  } catch {
    return "unknown";
  }
}

async function getAccessibleState(bus: any, dest: string, path: string): Promise<string[]> {
  try {
    const result = await callMethod(bus, dest, path, "org.a11y.atspi.Accessible", "GetState");
    // Result is an array of uint32 values
    const arr = Array.isArray(result) ? result : [result];
    return parseStates(arr);
  } catch {
    return [];
  }
}

async function getChildCount(bus: any, dest: string, path: string): Promise<number> {
  try {
    const result = await getProperty(bus, dest, path, "org.a11y.atspi.Accessible", "ChildCount");
    return typeof result?.[1]?.[0] === "number" ? result[1][0] : 0;
  } catch {
    return 0;
  }
}

async function getChildAtIndex(bus: any, dest: string, path: string, index: number): Promise<[string, string] | null> {
  try {
    const result = await callMethod(
      bus, dest, path,
      "org.a11y.atspi.Accessible", "GetChildAtIndex",
      "i", [index]
    );
    // Returns (bus_name, object_path)
    if (Array.isArray(result) && result.length >= 2) {
      return [result[0], result[1]];
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find the focused element in the AT-SPI2 tree.
 * Walks all applications on the desktop looking for the FOCUSED state.
 */
export async function getFocusedElement(): Promise<AccessibleElement | null> {
  const bus = await getConnection();
  const REGISTRY = "org.a11y.atspi.Registry";
  const ROOT = "/org/a11y/atspi/accessible/root";

  // Get desktop children (applications)
  const appCount = await getChildCount(bus, REGISTRY, ROOT);

  for (let i = 0; i < appCount; i++) {
    const app = await getChildAtIndex(bus, REGISTRY, ROOT, i);
    if (!app) continue;
    const [appDest, appPath] = app;
    const appName = await getAccessibleName(bus, appDest, appPath);

    // Skip non-Chrome apps
    if (!appName.includes("Chrome") && !appName.includes("Chromium")) continue;

    // Depth-first search for focused element
    const focused = await findFocused(bus, appDest, appPath, 0);
    if (focused) {
      focused.app = appName;
      return focused;
    }
  }

  return null;
}

async function findFocused(
  bus: any,
  dest: string,
  path: string,
  depth: number
): Promise<AccessibleElement | null> {
  if (depth > 30) return null;

  try {
    const count = await getChildCount(bus, dest, path);
    // Check children first (focused element may be deeply nested)
    for (let i = 0; i < Math.min(count, 50); i++) {
      const child = await getChildAtIndex(bus, dest, path, i);
      if (!child) continue;
      const result = await findFocused(bus, child[0], child[1], depth + 1);
      if (result) return result;
    }

    // Check this node
    const states = await getAccessibleState(bus, dest, path);
    if (states.includes("focused")) {
      const name = await getAccessibleName(bus, dest, path);
      const role = await getAccessibleRole(bus, dest, path);
      return { name, role, state: states };
    }
  } catch {}

  return null;
}

/**
 * Get basic info about the currently focused element.
 * Falls back to the active frame if no focused element found.
 */
export async function getItemInfo(): Promise<AccessibleElement | null> {
  const focused = await getFocusedElement();
  if (focused) return focused;

  // Fallback: find active frame
  const bus = await getConnection();
  const REGISTRY = "org.a11y.atspi.Registry";
  const ROOT = "/org/a11y/atspi/accessible/root";

  const appCount = await getChildCount(bus, REGISTRY, ROOT);
  for (let i = 0; i < appCount; i++) {
    const app = await getChildAtIndex(bus, REGISTRY, ROOT, i);
    if (!app) continue;
    const [appDest, appPath] = app;
    const appName = await getAccessibleName(bus, appDest, appPath);
    if (!appName.includes("Chrome") && !appName.includes("Chromium")) continue;

    const frame = await findActiveFrame(bus, appDest, appPath, 0);
    if (frame) {
      frame.app = appName;
      return frame;
    }
  }

  return null;
}

async function findActiveFrame(
  bus: any,
  dest: string,
  path: string,
  depth: number
): Promise<AccessibleElement | null> {
  if (depth > 15) return null;

  try {
    const role = await getAccessibleRole(bus, dest, path);
    const states = await getAccessibleState(bus, dest, path);

    if (role === "document web" || role === "document frame") {
      const name = await getAccessibleName(bus, dest, path);
      return { name, role, state: states };
    }
    if (role === "frame" && states.includes("active")) {
      const name = await getAccessibleName(bus, dest, path);
      return { name, role, state: states };
    }

    const count = await getChildCount(bus, dest, path);
    for (let i = 0; i < Math.min(count, 30); i++) {
      const child = await getChildAtIndex(bus, dest, path, i);
      if (!child) continue;
      const result = await findActiveFrame(bus, child[0], child[1], depth + 1);
      if (result) return result;
    }
  } catch {}

  return null;
}
