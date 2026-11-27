// The `review_changes` setting: whether Mod+S first opens the changes page. config.toml says it
// (applyAppConfig sets it); Save asks at the moment it is pressed.
let on = false;

export const reviewChangesOn = (): boolean => on;

export function setReviewChanges(next: boolean): void {
  on = next;
}
