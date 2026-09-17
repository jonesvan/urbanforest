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

COPY . /var/www/html

RUN chown -R www-data:www-data /var/www/html

EXPOSE 80
