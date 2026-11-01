/** Round category picture: the admin's image when there is one, otherwise the emoji. */
export default function CategoryAvatar({ image, icon, name = '', className = 'h-20 w-20', text = 'text-4xl' }) {
    return (<span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-cream-200 to-gold-300/60 shadow ring-2 ring-gold/50 ${className}`}>
      {image
            ? <img src={image} alt={name} loading="lazy" className="h-full w-full object-cover"/>
            : <span className={text} aria-hidden="true">{icon || '🎁'}</span>}
    </span>);
}
