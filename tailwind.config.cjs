/** Board styles, compiled at build time (scripts/build-ui.js) so the board needs no CDN. */
module.exports = {
  content: ['./src/ui/index.html', './src/ui/app.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        app: '#0c0d0e',
        sidebar: '#0d0e10',
        surface: '#121316',
        surfaceHover: '#17181c',
        borderSubtle: '#1a1b1f',
        borderDefault: '#23262e',
        borderActive: '#343844',
        pillActive: '#21242b',
      },
    },
  },
};
