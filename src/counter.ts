import { Effect, Signal } from "./reactive";

export function setupCounter(element: HTMLButtonElement) {
  const counter = Signal(0);
  Effect(() => {
    element.textContent = `count is ${counter()}`;
  });
  element.addEventListener("mousedown", () => counter.set(counter() + 1));
}
