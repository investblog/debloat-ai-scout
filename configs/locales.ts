export interface LocaleConfig {
	id: string;
	name: string;
	/** Accept-Language header value */
	acceptLanguage: string;
	/** Google search domain */
	googleDomain: string;
}

export const LOCALES: LocaleConfig[] = [
	{
		id: "en-US",
		name: "English (US)",
		acceptLanguage: "en-US,en;q=0.9",
		googleDomain: "google.com",
	},
];

export function getLocale(id: string): LocaleConfig | undefined {
	return LOCALES.find((l) => l.id === id);
}
