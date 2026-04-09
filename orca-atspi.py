#!/usr/bin/env python3
"""
AT-SPI2 helper for orca-driver.

Queries the Linux accessibility tree via AT-SPI2 and returns JSON to stdout.
Requires: python3-gi, gir1.2-atspi-2.0 (Debian/Ubuntu) or python3-pyatspi (Fedora).

Usage:
  python3 orca-atspi.py focused              # currently focused element
  python3 orca-atspi.py caret                 # element at caret (browse mode)
  python3 orca-atspi.py tree <pid>            # a11y tree for process (compact)
  python3 orca-atspi.py find <role> [<pid>]   # find elements by role in app
"""

import json
import sys

try:
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
except ImportError:
    print(json.dumps({
        "error": "AT-SPI2 GObject bindings not found. Install: sudo apt install python3-gi gir1.2-atspi-2.0"
    }))
    sys.exit(1)


# ── State mapping ────────────────────────────────────────────────────────────

STATE_MAP = {
    Atspi.StateType.CHECKED:    "checked",
    Atspi.StateType.EXPANDED:   "expanded",
    Atspi.StateType.COLLAPSED:  "collapsed",
    Atspi.StateType.SELECTED:   "selected",
    Atspi.StateType.FOCUSED:    "focused",
    Atspi.StateType.REQUIRED:   "required",
    Atspi.StateType.VISITED:    "visited",
    Atspi.StateType.ENABLED:    "enabled",
    Atspi.StateType.SENSITIVE:  "sensitive",
    Atspi.StateType.PRESSED:    "pressed",
    Atspi.StateType.EDITABLE:   "editable",
    Atspi.StateType.HAS_POPUP:  "has popup",
    Atspi.StateType.INVALID_ENTRY: "invalid",
}

# States to include in output (skip noisy internal ones)
REPORT_STATES = {
    "checked", "expanded", "collapsed", "selected", "required",
    "visited", "has popup", "pressed", "invalid",
}


def format_element(node):
    """Format an AT-SPI2 accessible node as a dict matching VoResponse shape."""
    try:
        name = node.get_name() or ""
        role_name = node.get_localized_role_name() or node.get_role_name() or ""

        state_set = node.get_state_set()
        states = []
        for atspi_state, label in STATE_MAP.items():
            if state_set.contains(atspi_state):
                if label in REPORT_STATES:
                    states.append(label)

        # Check for "not checked" on checkboxes
        role_enum = node.get_role()
        if role_enum == Atspi.Role.CHECK_BOX and "checked" not in states:
            states.insert(0, "unchecked")

        # Build spoken text mimicking screen reader output
        parts = []
        if name:
            parts.append(name)
        if role_name:
            parts.append(role_name)
        if states:
            parts.extend(states)
        spoken = ", ".join(parts) if parts else ""

        return {
            "spoken": spoken,
            "name": name,
            "role": role_name,
            "state": states,
        }
    except Exception as e:
        return {"error": f"Failed to read element: {e}"}


def find_focused(node, depth=0):
    """Recursively find the deepest focused element."""
    if depth > 50:
        return None
    try:
        state_set = node.get_state_set()
        focused_child = None

        count = node.get_child_count()
        for i in range(count):
            child = node.get_child_at_index(i)
            if child is None:
                continue
            child_states = child.get_state_set()
            if child_states.contains(Atspi.StateType.FOCUSED):
                # Keep searching deeper for the most specific focused element
                deeper = find_focused(child, depth + 1)
                focused_child = deeper if deeper else child

        if focused_child:
            return focused_child

        # If this node is focused and no child is, return this node
        if state_set.contains(Atspi.StateType.FOCUSED):
            return node

        return None
    except Exception:
        return None


def get_focused():
    """Get the currently focused accessible element across all apps."""
    desktop = Atspi.get_desktop(0)
    if desktop is None:
        return {"error": "Cannot connect to AT-SPI2 bus. Is at-spi2-core running?"}

    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app is None:
            continue
        focused = find_focused(app)
        if focused is not None:
            result = format_element(focused)
            result["app"] = app.get_name() or ""
            return result

    return {"error": "No focused element found. Is a window focused?"}


def get_app_by_pid(pid):
    """Find an application node by PID."""
    desktop = Atspi.get_desktop(0)
    if desktop is None:
        return None
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app is None:
            continue
        try:
            if app.get_process_id() == pid:
                return app
        except Exception:
            continue
    return None


def dump_tree(node, depth=0, max_depth=6):
    """Dump a compact accessibility tree."""
    if depth > max_depth:
        return None

    try:
        name = node.get_name() or ""
        role = node.get_localized_role_name() or node.get_role_name() or ""
        entry = {"role": role}
        if name:
            entry["name"] = name

        state_set = node.get_state_set()
        states = []
        for atspi_state, label in STATE_MAP.items():
            if state_set.contains(atspi_state) and label in REPORT_STATES:
                states.append(label)
        if states:
            entry["state"] = states

        children = []
        count = node.get_child_count()
        for i in range(min(count, 200)):  # cap to avoid huge trees
            child = node.get_child_at_index(i)
            if child is None:
                continue
            child_entry = dump_tree(child, depth + 1, max_depth)
            if child_entry:
                children.append(child_entry)
        if children:
            entry["children"] = children

        return entry
    except Exception:
        return None


def find_by_role(target_role, app_node=None):
    """Find all elements matching a role name."""
    results = []
    root = app_node or Atspi.get_desktop(0)
    if root is None:
        return results
    _collect_by_role(root, target_role.lower(), results, depth=0)
    return results


def _collect_by_role(node, target_role, results, depth):
    if depth > 30 or len(results) >= 50:
        return
    try:
        role = (node.get_localized_role_name() or node.get_role_name() or "").lower()
        if target_role in role:
            results.append(format_element(node))
        count = node.get_child_count()
        for i in range(count):
            child = node.get_child_at_index(i)
            if child:
                _collect_by_role(child, target_role, results, depth + 1)
    except Exception:
        pass


# ── CLI dispatch ─────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: orca-atspi.py <focused|tree|find> [args...]"}))
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "focused":
        result = get_focused()
        print(json.dumps(result))

    elif cmd == "tree":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "tree requires a PID argument"}))
            sys.exit(1)
        pid = int(sys.argv[2])
        app = get_app_by_pid(pid)
        if app is None:
            print(json.dumps({"error": f"No app found with PID {pid}"}))
            sys.exit(1)
        tree = dump_tree(app)
        print(json.dumps(tree or {"error": "Empty tree"}))

    elif cmd == "find":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "find requires a role argument"}))
            sys.exit(1)
        role = sys.argv[2]
        app_node = None
        if len(sys.argv) >= 4:
            pid = int(sys.argv[3])
            app_node = get_app_by_pid(pid)
        results = find_by_role(role, app_node)
        print(json.dumps({"elements": results, "count": len(results)}))

    else:
        print(json.dumps({"error": f"Unknown command: {cmd}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
