// FN-2: Sort display bug
// When sort is applied via the server, the displayed text (name, price) is correctly sorted.
// However, the <a href> links inside each card still point to the ORIGINAL product.
// This is because the server correctly sorts products, but the card links are set
// by the server-rendered href, so this actually works correctly from the server side.
//
// The REAL FN-2 bug is in client-side JavaScript sort:
// When the user clicks sort, we re-sort DOM elements visually but don't update hrefs.

// FP-5: Re-enable pointer-events after animation completes
// This runs AFTER the animation, but there's a brief window where clicks are blocked
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.animate-in').forEach(function(card) {
    card.addEventListener('animationend', function() {
      card.classList.add('animated');
    });
  });
});

document.addEventListener('DOMContentLoaded', function() {
  const sortSelect = document.getElementById('sort-select');
  if (!sortSelect) return;

  // Override the default server-side sort with a client-side sort
  // that has the FN-2 bug (doesn't update links)
  sortSelect.addEventListener('change', function(e) {
    // Only intercept if JavaScript is doing client-side sort
    // The default behavior (server reload) is correct, so we let it through
    // But we add a client-side "quick sort" that fires first with the bug

    const grid = document.getElementById('product-grid');
    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll('.product-card'));
    const sortValue = e.target.value;

    if (sortValue === 'price_asc' || sortValue === 'price_desc') {
      // Store original hrefs before sort (they won't move with the elements)
      const originalHrefs = cards.map(card => {
        const link = card.querySelector('.card-link');
        return link ? link.getAttribute('href') : '#';
      });

      // Sort the visual elements
      cards.sort((a, b) => {
        const priceA = parseInt(a.querySelector('.product-price').dataset.price);
        const priceB = parseInt(b.querySelector('.product-price').dataset.price);
        return sortValue === 'price_asc' ? priceA - priceB : priceB - priceA;
      });

      // Re-append sorted cards to grid
      cards.forEach(card => grid.appendChild(card));

      // FN-2 BUG: We do NOT update the href links after re-ordering
      // The visual order is correct, but clicking a card may go to the wrong product
      // because the href was set based on the original order
    }
  });
});
