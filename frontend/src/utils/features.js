/** Plan feature keys from `/auth/login` and `/auth/me` (`user.features`). */
export function hasFeature(user, key) {
  const f = user?.features || [];
  return f.includes('*') || f.includes(key);
}
