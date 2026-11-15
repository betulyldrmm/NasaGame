/** Ana menüde miyiz? Dil seçimi yalnızca ana menüde (ve giriş ekranında) görünür. */
let inMenu = true
const subs = new Set<() => void>()
export const menuState = {
  get: () => inMenu,
  set(v: boolean) {
    if (v === inMenu) return
    inMenu = v
    subs.forEach((s) => s())
  },
  subscribe(s: () => void) {
    subs.add(s)
    return () => {
      subs.delete(s)
    }
  },
}
