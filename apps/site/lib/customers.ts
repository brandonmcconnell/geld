/** Companies whose founders and engineers review with Geld, in the order the logo reel shows them. */

export interface CustomerLogo {
  /** Single-colour SVG in `public/logos/`, drawn as a mask so it takes the text colour in both schemes. */
  readonly src: string;
  /** The SVG's viewBox width over its height. */
  readonly aspect: number;
  /** Rendered height in pixels, tuned per logo so the wordmarks read at one optical size. */
  readonly height: number;
}

export interface Customer {
  readonly name: string;
  readonly url: string;
  readonly logo: CustomerLogo;
  /** The logo is a mark only, so the name is set beside it (as the company's own header does). */
  readonly markOnly: boolean;
}

export const CUSTOMERS: readonly Customer[] = [
  { name: 'Replicas', url: 'https://replicas.dev', logo: { src: '/logos/replicas.svg', aspect: 225 / 300, height: 22 }, markOnly: true },
  { name: 'OpenAI', url: 'https://openai.com', logo: { src: '/logos/openai.svg', aspect: 1, height: 24 }, markOnly: true },
  { name: 'Autumn', url: 'https://useautumn.com', logo: { src: '/logos/autumn.svg', aspect: 114 / 28, height: 26 }, markOnly: false },
  { name: 'Notra', url: 'https://www.usenotra.com', logo: { src: '/logos/notra.svg', aspect: 1, height: 24 }, markOnly: true },
  { name: 'Vercel', url: 'https://vercel.com', logo: { src: '/logos/vercel.svg', aspect: 261 / 52, height: 20 }, markOnly: false },
  { name: 'CodeRabbit', url: 'https://www.coderabbit.ai', logo: { src: '/logos/coderabbit.svg', aspect: 145 / 18, height: 19 }, markOnly: false },
  { name: 'Mercury', url: 'https://mercury.com', logo: { src: '/logos/mercury.svg', aspect: 139 / 32, height: 36 }, markOnly: false },
  { name: 'Tesser', url: 'https://tesser.sh', logo: { src: '/logos/tesser.svg', aspect: 1, height: 22 }, markOnly: true },
  { name: 'Limetax', url: 'https://www.limetax.de', logo: { src: '/logos/limetax.svg', aspect: 95.254 / 16.001, height: 21 }, markOnly: false },
  { name: 'Loctax', url: 'https://www.loctax.com', logo: { src: '/logos/loctax.svg', aspect: 1, height: 22 }, markOnly: true },
];
