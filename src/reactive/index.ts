const NONE = Symbol("NONE");

let context: ReactiveNode | typeof NONE = NONE;

class ReactiveNode {
  dirty = false;

  subs = new Set<WeakRef<ReactiveNode>>();
  deps = new Set<ReactiveNode>();

  ctxDeps = new Set<ReactiveNode>();

  subscribe(sub: ReactiveNode): void {
    const included = [...this.subs].some((ref) => Object.is(ref.deref(), sub));
    if (!included) {
      this.subs.add(new WeakRef(sub));
    }
  }

  unsubscribe(sub: ReactiveNode): void {
    this.subs.forEach((ref) => {
      if (Object.is(sub, ref.deref())) {
        this.subs.delete(ref);
      }
    });
  }

  markAsDisty(): void {
    if (!this.dirty) {
      this.dirty = true;

      for (const ref of this.subs) {
        const sub = ref.deref();
        if (sub) {
          sub.markAsDisty();
        } else {
          this.subs.delete(ref);
        }
      }
    }
  }

  addAsSub(): void {
    const ctx = context;
    if (ctx === NONE) return;

    this.subscribe(ctx);
    ctx.ctxDeps.add(this);
  }
}

class WritableNode<T> extends ReactiveNode {
  constructor(private value: T) {
    super();
  }

  setValue(value: T): void {
    this.value = value;

    for (const ref of this.subs) {
      const sub = ref.deref();
      if (sub) {
        sub.markAsDisty();
      } else {
        this.subs.delete(ref);
      }
    }
  }

  getValue(): T {
    this.addAsSub();
    return this.value;
  }
}

class ComputedNode<T> extends ReactiveNode {
  value: T | typeof NONE = NONE;

  constructor(private computationFn: () => T) {
    super();
  }

  getValue(): T {
    this.addAsSub();
    if (this.value === NONE || this.dirty) {
      this.value = this.compute();
      this.dirty = false;
    }
    return this.value;
  }

  compute(): T {
    const prevCtx = context;
    context = this;
    const value = this.computationFn();

    for (const dep of this.deps) {
      if (!this.ctxDeps.has(dep)) {
        this.deps.delete(dep);
        dep.unsubscribe(this);
      }
    }

    for (const ctxDep of this.ctxDeps) {
      if (!this.deps.has(ctxDep)) {
        this.deps.add(ctxDep);
      }
    }

    this.ctxDeps.clear();

    context = prevCtx;

    return value;
  }
}

class EffectNode extends ReactiveNode {
  taskScheduled = false;
  destroyed = false;

  constructor(public effectFn: () => void) {
    super();

    this.markAsDisty();
  }

  override markAsDisty(): void {
    if (this.taskScheduled || this.destroyed) {
      return;
    }

    queueMicrotask(() => {
      this.runEffect();
      this.taskScheduled = false;
    });
    this.taskScheduled = true;
  }

  runEffect(): void {
    const prevCtx = context;
    context = this;
    const value = this.effectFn();

    for (const dep of this.deps) {
      if (!this.ctxDeps.has(dep)) {
        this.deps.delete(dep);
        dep.unsubscribe(this);
      }
    }

    for (const ctxDep of this.ctxDeps) {
      if (!this.deps.has(ctxDep)) {
        this.deps.add(ctxDep);
      }
    }

    this.ctxDeps.clear();

    context = prevCtx;

    return value;
  }

  destroy(): void {
    this.deps.forEach((dep) => dep.unsubscribe(this));
    this.deps.clear();
    this.destroyed = true;
  }
}

export function Signal<T>(
  value: T,
  opts: { equal: (a: T, b: T) => boolean } = { equal: Object.is },
) {
  const node = new WritableNode(value);
  const signalFn = () => node.getValue();
  signalFn.set = (value: T) => {
    if (!opts.equal(node.getValue(), value)) node.setValue(value);
  };
  return signalFn;
}

export function Computed<T>(conputationFn: () => T) {
  const node = new ComputedNode(conputationFn);
  const computedFn = () => node.getValue();
  return computedFn;
}

const EFFECTS = Symbol("EFFECTS");

declare const window: Window & {
  [key in typeof EFFECTS]: Set<EffectNode> | undefined;
};

export function Effect(effectFn: () => void) {
  let node: EffectNode | null = new EffectNode(effectFn);
  window[EFFECTS] ??= new Set();
  window[EFFECTS].add(node);

  return {
    destroy: () => {
      if (node) {
        window[EFFECTS]?.delete(node);
        node?.destroy();
        node = null;
      }
    },
  };
}
