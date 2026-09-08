declare module 'kute.js/src/components/svgMorph' {
  type Polygon = [number, number][]

  const svgMorph: {
    Interpolate: (source: Polygon, target: Polygon, length: number, progress: number) => Polygon
    Util: {
      getInterpolationPoints: (
        source: string,
        target: string,
        precision: number,
      ) => [Polygon, Polygon]
    }
  }

  export default svgMorph
}
