# PHP 7.4 CLI for FastAdmin baseline testing.
FROM php:7.4-cli

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip libzip-dev libpng-dev libjpeg-dev libfreetype6-dev \
        libonig-dev libcurl4-openssl-dev libssl-dev libxml2-dev \
        default-mysql-client \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql mbstring bcmath gd zip curl exif \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

# Increase upload/post limits so chunked-upload tests work.
RUN { \
        echo "upload_max_filesize=64M"; \
        echo "post_max_size=64M"; \
        echo "memory_limit=512M"; \
        echo "date.timezone=PRC"; \
    } > /usr/local/etc/php/conf.d/zz-fastadmin-test.ini

EXPOSE 80

CMD ["php", "-S", "0.0.0.0:80", "-t", "/app/public", "/app/public/router.php"]
