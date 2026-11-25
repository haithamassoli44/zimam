/** A button for something picked, like a filter's value: the accent when on. */
export function pressed(on: boolean) {
  return on
    ? ({ color: 'primary', variant: 'subtle' } as const)
    : ({ color: 'neutral', variant: 'outline', class: 'text-toned' } as const)
}

/** A button for how something shows, like the diff's split view: a step of the surface when on, as the accent is for what's picked. */
export function shown(on: boolean) {
  return on
    ? ({ color: 'neutral', variant: 'outline', class: 'bg-accented/70 text-highlighted hover:bg-accented/70' } as const)
    : ({ color: 'neutral', variant: 'outline', class: 'text-toned' } as const)
}
