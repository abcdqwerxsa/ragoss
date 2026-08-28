/** Minimal provider registry: type-string -> factory. */
export type Factory<C, P> = (cfg: C) => P;

export class Registry<C, P> {
  #factories = new Map<string, Factory<C, P>>();

  register(type: string, factory: Factory<C, P>): void {
    this.#factories.set(type, factory);
  }

  build(type: string, cfg: C): P {
    const f = this.#factories.get(type);
    if (!f) throw new Error(`no provider registered for type "${type}"`);
    return f(cfg);
  }
}
