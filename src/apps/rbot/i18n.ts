import Knex from 'knex';
import { Context } from "telegraf";
import i18next from 'i18next';
import type { TFunction } from 'i18next';
import en from './locales/en.json'
import zh from './locales/zh-cn.json'

console.log('RUN ------------ i18n.ts')
i18next
  .init({
    debug: true,
    lng: 'en',
    fallbackLng: 'en',
    resources: { en, zh }
  });

export interface I18nContext extends Context {
  i18n: TFunction
}

export default i18next


/*
CREATE TABLE rbot_settings (
  uid bigint PRIMARY KEY,
  language text NOT NULL
);
*/
export interface RbotSettings {
  uid: number;
  language: string; // en zh
}

export const getLanguage = async (pool: Knex.Knex, uid: number) => {
  const settings = await pool
    .select()
    .from('rbot_settings')
    .where({ uid })
    .first() as RbotSettings | undefined;
  if (settings) {
    return settings.language
  } else {
    return 'en'
  }
}

export const setLanguage = async (pool: Knex.Knex, uid: number, language: string) => {
  await pool('rbot_settings')
    .insert({ uid, language })
    .onConflict('uid')
    .merge()
}
