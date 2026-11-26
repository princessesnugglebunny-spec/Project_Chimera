const metadata = await fetch('./build.json').then((response) => response.json());
document.querySelector('#build').innerHTML = Object.entries(metadata)
  .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join('');
