import { profile } from '../data/site'

/** Avatar + name + handle, laid out by the parent container. */
export function Identity() {
  return (
    <>
      <img className="avatar" src={profile.avatarSmall} alt={profile.name} />
      <div className="who">
        <span className="name">{profile.name}</span>
        <span className="handle">{profile.handle}</span>
      </div>
    </>
  )
}
