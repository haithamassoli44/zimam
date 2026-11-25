// Buttons that stay pressed while something is on. Off, both look the same.
const OFF = { color: 'neutral', variant: 'outline', class: 'text-toned' } as const

/** A button for something picked, like a filter's value: the accent when on. */
export const pressed = (on: boolean) => (on ? ({ color: 'primary', variant: 'subtle' } as const) : OFF)

/** A button for how something shows, like the diff's split view: a step of the surface when on, as the accent is for what's picked. */
export const shown = (on: boolean) =>
  on
    ? ({ color: 'neutral', variant: 'outline', class: 'bg-accented/70 text-highlighted hover:bg-accented/70' } as const)
    : OFF
