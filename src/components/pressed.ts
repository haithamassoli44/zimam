export function pressed(on: boolean) {
  return on
    ? ({ color: 'primary', variant: 'subtle' } as const)
    : ({ color: 'neutral', variant: 'outline', class: 'text-toned' } as const)
}
