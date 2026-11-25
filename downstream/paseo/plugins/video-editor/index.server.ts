// Built-ins require a server contribution to publish their client bundle. Video RPCs are
// deliberately handled by the daemon Session, where the authenticated principal is available.
export default function contribute(): () => void {
  // Do not register a second broker here.
  return () => {};
}
