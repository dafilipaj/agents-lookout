/** VIEW-1.18: the most paths one check takes, and the longest path it looks up. */
export const MAX_PATHS = 100;
export const MAX_PATH_LENGTH = 1024;

/**
 * VIEW-1.18: the server's answer for one path of a check, in the order asked: whether it's a file,
 * and if it is, its absolute path. Nothing else about it, never its contents.
 */
export interface PathAnswer {
  path: string;
  exists: boolean;
  absolute: string | null;
}
