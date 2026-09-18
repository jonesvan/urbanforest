FROM php:8.4-apache

ENV APACHE_DOCUMENT_ROOT=/var/www/html/public

RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
 && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \
 && a2enmod rewrite headers deflate expires

RUN printf 'ServerName localhost\n' > /etc/apache2/conf-available/servername.conf \
 && a2enconf servername \
 && printf 'AddOutputFilterByType DEFLATE application/json application/geo+json image/svg+xml text/css text/javascript application/javascript\n' \
    > /etc/apache2/conf-available/deflate-extra.conf \
 && a2enconf deflate-extra

# Copy in ascending order of change frequency so cached layers survive: the
# large, rarely-touched tile and data trees stay cached, and only the small
# code/assets layers below them are rebuilt and re-pushed on a normal deploy.
# --chown avoids a separate `chown -R` layer, which would copy every file again.
COPY --chown=www-data:www-data public/tiles /var/www/html/public/tiles

COPY --chown=www-data:www-data public/data /var/www/html/public/data

COPY --chown=www-data:www-data public/index.php /var/www/html/public/index.php
COPY --chown=www-data:www-data public/api /var/www/html/public/api
COPY --chown=www-data:www-data public/assets /var/www/html/public/assets
COPY --chown=www-data:www-data config.php /var/www/html/config.php

EXPOSE 80
