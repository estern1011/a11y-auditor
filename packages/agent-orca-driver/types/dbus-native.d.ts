declare module "dbus-native" {
  interface Message {
    destination?: string;
    path?: string;
    interface?: string;
    member?: string;
    signature?: string;
    body?: unknown[];
  }

  interface DBusConnection {
    invoke(msg: Message, callback: (err: Error | null, result: unknown) => void): void;
    on(event: string, callback: (...args: unknown[]) => void): void;
    connection?: { end(): void };
  }

  function createClient(options: { busAddress: string }): DBusConnection;
  function sessionBus(): DBusConnection;

  const dbus: {
    createClient: typeof createClient;
    sessionBus: typeof sessionBus;
  };

  export = dbus;
}
