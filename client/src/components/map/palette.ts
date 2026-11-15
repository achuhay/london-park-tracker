/**
 * Colours for things Leaflet draws on the map (it needs real colour values, not CSS variables).
 * Keep these in step with the tokens in index.css.
 */
export interface MapPalette {
  /** Parks you still need to visit */
  todo: string;
  todoFill: number;
  /** Parks you've run through */
  done: string;
  doneFill: number;
  /** Your 4–5 star favourites (outline) */
  favourite: string;
  /** Parks in the route you're planning (outline) */
  planned: string;
  /** Parks on an uploaded GPX route preview */
  preview: string;
  /** Not-public parks shown in data review mode */
  suspect: string;
  /** The park whose card is open */
  selected: string;
  /** Your Strava runs drawn on the map */
  run: string;
}

export const LIGHT_MAP: MapPalette = {
  todo: "#3B8659",
  todoFill: 0.16,
  done: "#E8590F",
  doneFill: 0.55,
  favourite: "#D9A21B",
  planned: "#171714",
  preview: "#2563EB",
  suspect: "#DC2626",
  selected: "#171714",
  run: "#FC4C02",
};

export const DARK_MAP: MapPalette = {
  todo: "#5CB283",
  todoFill: 0.14,
  done: "#F7712C",
  doneFill: 0.6,
  favourite: "#F2C94C",
  planned: "#F2F1EC",
  preview: "#60A5FA",
  suspect: "#F87171",
  selected: "#FFFFFF",
  run: "#FF7A3D",
};

export const mapPalette = (dark: boolean) => (dark ? DARK_MAP : LIGHT_MAP);
