import './docs.css';
import { videosUrl } from './i18n';
import { initPageLang } from './docsLang';
import { initVideos } from './videos/player';

// The video page: all videos in groups, with the guide's header and the same player.
initPageLang(videosUrl, {
  de: ['Diese Seite gibt es auch ', 'auf Deutsch'],
  en: ['This page is also ', 'in English'],
});
initVideos();
