/** Host loader entry for the browser implementation exported from `./client`. */

/**
 * Host plugin body — no host-side behavior for the settings shell.
 *
 * This package used to declare the `ui-onboarding` settings namespace for the
 * product-wide welcome notice. The notice was removed, and the namespace had no
 * other reader, so both went with it and the durable seam is gone.
 */
export function apply(): void {}
